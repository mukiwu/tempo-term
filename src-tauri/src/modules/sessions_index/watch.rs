//! Watches the three agent roots and re-syncs changed files, debounced.
//!
//! Every notify callback (one per watched root) just pushes the paths it saw
//! onto a single shared mpsc channel — no work happens on the notify
//! callback thread itself. A single worker thread drains that channel in
//! `recv_timeout(500ms)` batches, maps each drained path back to its owning
//! agent by matching it against the resolved root list (a `-wal`/`-shm`
//! companion maps back to its `.db` first), re-syncs the dirty files via
//! `sync::sync_file_unlocked` (which only ever locks the index briefly, never
//! while parsing), and emits one `sessions-index:updated` event per batch
//! that actually changed something — so a burst of writes from an actively
//! streaming session collapses into a single frontend refresh instead of one
//! per filesystem event.
//!
//! This module is intentionally thin: the interesting logic (fingerprinting,
//! parsing, upserting) lives in `sync.rs` and is unit-tested there. Only the
//! pure path-resolution helpers here get their own tests; the watcher
//! thread's timing/OS integration is exercised by hand, not in CI.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use super::index::Index;
use super::scanner;
use super::sync::sync_file_unlocked;

/// How long the worker thread waits for another event before flushing the
/// batch it has collected so far.
const DEBOUNCE: Duration = Duration::from_millis(500);

/// Frontend event name: sessions changed on disk, refetch `sessions_list`.
pub const UPDATED_EVENT: &str = "sessions-index:updated";

#[derive(Clone, serde::Serialize)]
struct UpdatedPayload {
    count: usize,
}

/// Emits `UPDATED_EVENT`; also used by `mod.rs` after the initial full sync
/// completes, so the startup sync and the debounced re-sync share one
/// payload shape.
pub(crate) fn emit_updated(app: &AppHandle, count: usize) {
    let _ = app.emit(UPDATED_EVENT, UpdatedPayload { count });
}

/// Which `RecursiveMode` a given (agent, root) pair should be watched with.
/// Claude's `projects/` root is recursive because new project directories
/// appear over time; Codex's `sessions/` root is recursive for its
/// `YYYY/MM/DD` layout, but `archived_sessions/` is flat; Antigravity's
/// `conversations/` root is flat too.
fn watch_mode(agent: &str, root: &Path) -> RecursiveMode {
    match agent {
        "claude" => RecursiveMode::Recursive,
        "codex" if root.file_name().and_then(|n| n.to_str()) == Some("archived_sessions") => {
            RecursiveMode::NonRecursive
        }
        "codex" => RecursiveMode::Recursive,
        _ => RecursiveMode::NonRecursive,
    }
}

/// Maps a raw changed path back to its `.db` file when it is a SQLite `-wal`
/// companion (Antigravity CLI checkpoints the WAL into the main file lazily,
/// so a write can land on the companion only). A `-shm` companion returns
/// `None` — SQLite touches shared memory merely from opening the database
/// (even read-only, as our own parser does), so reacting to `-shm` events
/// turns every re-parse into the trigger for the next one. Real data changes
/// always come with a `.db` or `-wal` event. Any other path passes through.
fn strip_wal_shm(path: &Path) -> Option<PathBuf> {
    let name = path.file_name().and_then(|n| n.to_str())?;
    if name.ends_with("-shm") {
        return None;
    }
    match name.strip_suffix("-wal") {
        Some(base) => Some(path.with_file_name(base)),
        None => Some(path.to_path_buf()),
    }
}

/// Resolves a raw changed path to the (agent, session file path) it belongs
/// to, or `None` when it falls outside every watched root (e.g. a
/// `.db-journal` companion, or a decoy file the scanner would also reject).
fn resolve(roots: &[(&'static str, PathBuf)], changed_path: &Path) -> Option<(&'static str, PathBuf)> {
    let mapped = strip_wal_shm(changed_path)?;
    let (agent, root) = roots.iter().find(|(_, root)| mapped.starts_with(root))?;
    if !is_session_file(agent, root, &mapped) {
        return None;
    }
    Some((*agent, mapped))
}

/// Mirrors the scanner's per-agent discovery rules for a single changed path,
/// so watcher events only re-sync files the scanner would also index. The
/// recursive Claude watch otherwise floods the sync loop with `subagents/`
/// and `tool-results/` companion writes — every one a wasted whole-file
/// parse whose result is always `None` (their entries are all sidechain).
fn is_session_file(agent: &str, root: &Path, path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str());
    match agent {
        // Only `<root>/<project-dir>/<session>.jsonl` — exactly two levels
        // below the projects root, never inside a session's companion dirs.
        "claude" => {
            ext == Some("jsonl")
                && path
                    .parent()
                    .and_then(Path::parent)
                    .is_some_and(|grandparent| grandparent == root)
        }
        // Rollouts under sessions/YYYY/MM/DD, plain .jsonl in archived_sessions.
        "codex" => {
            ext == Some("jsonl")
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|name| {
                        name.starts_with("rollout-")
                            || root.file_name().and_then(|n| n.to_str()) == Some("archived_sessions")
                    })
        }
        // The strip_wal_shm mapping already folded companions into the .db.
        "antigravity" => ext == Some("db"),
        _ => false,
    }
}

/// Start watching every agent root that already exists under `home`, and
/// return the live watcher handles — the caller must keep them alive (e.g.
/// in app state); dropping one stops its OS-level subscription. Roots that
/// don't exist yet (an agent the user has never run) are simply skipped,
/// never an error.
pub fn start(app: &AppHandle, home: &Path, index: Arc<Mutex<Index>>) -> Vec<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let roots = scanner::roots_from_env(home);

    let mut watchers = Vec::new();
    for (agent, root) in &roots {
        if !root.is_dir() {
            continue;
        }
        let mode = watch_mode(agent, root);
        let tx = tx.clone();
        let built = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            // No work here beyond forwarding paths: parsing/upserting must
            // never happen on notify's own callback thread.
            if let Ok(event) = res {
                for path in event.paths {
                    let _ = tx.send(path);
                }
            }
        });
        let Ok(mut watcher) = built else { continue };
        if watcher.watch(root, mode).is_ok() {
            watchers.push(watcher);
        }
    }

    let app = app.clone();
    std::thread::spawn(move || drain_loop(app, index, roots, rx));

    watchers
}

/// Drains the channel in `DEBOUNCE`-spaced batches for the lifetime of the
/// app, syncing whatever changed and emitting at most one event per batch.
/// Returns (ending the thread) once every sender has been dropped, i.e. every
/// watcher this batch belongs to was torn down.
fn drain_loop(
    app: AppHandle,
    index: Arc<Mutex<Index>>,
    roots: Vec<(&'static str, PathBuf)>,
    rx: mpsc::Receiver<PathBuf>,
) {
    loop {
        let first = match rx.recv_timeout(DEBOUNCE) {
            Ok(path) => path,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        };
        let mut batch = vec![first];
        // Drain whatever else has piled up without waiting for it.
        while let Ok(path) = rx.try_recv() {
            batch.push(path);
        }

        // Each file is synced via sync_file_unlocked, which locks the index
        // only for its brief needs_sync check and its commit — never while
        // parsing — so a burst of changed files never holds the lock for
        // the whole batch (see sync.rs's doc comment on the same shape in
        // full_sync).
        let mut dirty = 0usize;
        let mut synced_this_batch: HashSet<PathBuf> = HashSet::new();
        for path in batch {
            let Some((agent, session_path)) = resolve(&roots, &path) else { continue };
            // A single write can fire several raw events for the same
            // file (data + metadata); only sync it once per batch.
            if !synced_this_batch.insert(session_path.clone()) {
                continue;
            }
            if sync_file_unlocked(&index, agent, &session_path) {
                dirty += 1;
            }
        }

        // Only emit when the batch actually changed something the frontend
        // would need to refetch; a batch of decoy/no-op events stays silent.
        if dirty > 0 {
            eprintln!(
                "[sessions] watch batch: {} synced of {} events",
                dirty,
                synced_this_batch.len()
            );
            emit_updated(&app, dirty);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_roots() -> Vec<(&'static str, PathBuf)> {
        vec![
            ("claude", PathBuf::from("/home/u/.claude/projects")),
            ("codex", PathBuf::from("/home/u/.codex/sessions")),
            ("codex", PathBuf::from("/home/u/.codex/archived_sessions")),
            ("antigravity", PathBuf::from("/home/u/.gemini/antigravity-cli/conversations")),
        ]
    }

    #[test]
    fn strip_wal_shm_maps_a_wal_companion_back_to_the_db() {
        assert_eq!(
            strip_wal_shm(Path::new("/a/convo.db-wal")),
            Some(PathBuf::from("/a/convo.db"))
        );
    }

    #[test]
    fn strip_wal_shm_drops_shm_events_entirely() {
        // -shm changes are a side effect of merely opening the DB (our own
        // parser included); reacting to them re-arms the sync loop forever.
        assert_eq!(strip_wal_shm(Path::new("/a/convo.db-shm")), None);
    }

    #[test]
    fn strip_wal_shm_leaves_other_paths_unchanged() {
        assert_eq!(strip_wal_shm(Path::new("/a/convo.db")), Some(PathBuf::from("/a/convo.db")));
        assert_eq!(
            strip_wal_shm(Path::new("/a/session.jsonl")),
            Some(PathBuf::from("/a/session.jsonl"))
        );
    }

    #[test]
    fn resolve_ignores_shm_events() {
        let roots = sample_roots();
        assert_eq!(
            resolve(&roots, Path::new("/home/u/.gemini/antigravity-cli/conversations/convo1.db-shm")),
            None
        );
    }

    #[test]
    fn resolve_matches_a_path_under_its_owning_root() {
        let roots = sample_roots();
        let path = Path::new("/home/u/.claude/projects/projA/session1.jsonl");
        assert_eq!(resolve(&roots, path), Some(("claude", path.to_path_buf())));
    }

    #[test]
    fn resolve_rejects_claude_companion_files_the_scanner_would_skip() {
        let roots = sample_roots();
        // Subagent transcripts and tool-result dumps live BELOW a session's
        // companion dir; the recursive watch sees them but they are not
        // sessions and must not trigger a re-sync.
        assert_eq!(
            resolve(&roots, Path::new("/home/u/.claude/projects/projA/sess-1/subagents/agent-x.jsonl")),
            None
        );
        assert_eq!(
            resolve(&roots, Path::new("/home/u/.claude/projects/projA/sess-1/tool-results/t1.txt")),
            None
        );
        // A directory-level event on the project dir itself is not a session.
        assert_eq!(resolve(&roots, Path::new("/home/u/.claude/projects/projA")), None);
    }

    #[test]
    fn resolve_rejects_codex_non_rollout_noise_but_keeps_archived_jsonl() {
        let roots = sample_roots();
        assert_eq!(
            resolve(&roots, Path::new("/home/u/.codex/sessions/2026/07/07/rollout-x.jsonl")),
            Some(("codex", PathBuf::from("/home/u/.codex/sessions/2026/07/07/rollout-x.jsonl")))
        );
        assert_eq!(resolve(&roots, Path::new("/home/u/.codex/sessions/2026/07/07/notes.txt")), None);
        assert_eq!(
            resolve(&roots, Path::new("/home/u/.codex/archived_sessions/old.jsonl")),
            Some(("codex", PathBuf::from("/home/u/.codex/archived_sessions/old.jsonl")))
        );
    }

    #[test]
    fn resolve_maps_a_wal_companion_back_to_its_db_before_matching() {
        let roots = sample_roots();
        let wal = Path::new("/home/u/.gemini/antigravity-cli/conversations/convo1.db-wal");
        let expected = PathBuf::from("/home/u/.gemini/antigravity-cli/conversations/convo1.db");
        assert_eq!(resolve(&roots, wal), Some(("antigravity", expected)));
    }

    #[test]
    fn resolve_returns_none_outside_every_root() {
        let roots = sample_roots();
        assert_eq!(resolve(&roots, Path::new("/home/u/unrelated/file.txt")), None);
    }

    #[test]
    fn watch_mode_is_recursive_for_claude_and_codex_sessions_but_flat_for_the_rest() {
        assert_eq!(watch_mode("claude", Path::new("/x/projects")), RecursiveMode::Recursive);
        assert_eq!(watch_mode("codex", Path::new("/x/sessions")), RecursiveMode::Recursive);
        assert_eq!(
            watch_mode("codex", Path::new("/x/archived_sessions")),
            RecursiveMode::NonRecursive
        );
        assert_eq!(watch_mode("antigravity", Path::new("/x/conversations")), RecursiveMode::NonRecursive);
    }
}
