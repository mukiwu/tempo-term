//! Sync and update logic for the sessions index: turns discovered files into
//! upserts (or skips) via the fingerprint cache in `Index::needs_sync`, and
//! reconciles the index with what is actually on disk. Every sync is a
//! whole-file re-parse; there is no offset tailing here (unlike
//! claude_progress/codex_progress), because the index only stores derived
//! metadata, never message bodies, so re-deriving it from scratch is cheap
//! and never needs to reconcile a partial update.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::index::Index;
use super::scanner;
use super::types::ParsedSession;
use super::{antigravity, claude, codex};

/// mtime (milliseconds since epoch) and size (bytes) for `path`, or `(0, 0)`
/// if it cannot be stat'd. A missing file is not an error here: a watcher can
/// observe a path mid-delete, and an Antigravity `.db`'s `-wal`/`-shm`
/// companions are frequently absent entirely (no pending WAL is normal).
fn stat(path: &Path) -> (i64, i64) {
    match std::fs::metadata(path) {
        Ok(meta) => {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            (mtime, meta.len() as i64)
        }
        Err(_) => (0, 0),
    }
}

/// `path` with `suffix` appended to its file name, e.g. `a.db` + `-wal` ->
/// `a.db-wal`. Plain string concatenation on the OS string, not
/// `set_extension`, since the suffix is not a `.`-prefixed extension.
fn companion_path(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// Change-detection fingerprint for a session source file: mtime + size. For
/// an Antigravity `.db` file, the fingerprint also folds in its `-wal`
/// companion's mtime/size (summed into the same two numbers), so a commit
/// that only touches the WAL file (not yet checkpointed back into the main
/// `.db`) still changes the fingerprint and triggers a re-parse. Claude and
/// Codex sources are plain single files with no such companions.
///
/// The `-shm` companion is deliberately excluded: SQLite touches the
/// shared-memory file merely from OPENING a WAL-mode database — even
/// read-only, as our own parser does — so folding it in makes every re-parse
/// move the fingerprint, which the watcher then treats as a fresh change and
/// re-syncs, touching `-shm` again: a self-sustaining 500 ms sync loop
/// (observed in the field). Real new data always reaches the WAL or the main
/// file; `-shm` carries no persistent state.
pub fn fingerprint(path: &Path) -> (i64, i64) {
    let (mut mtime, mut size) = stat(path);
    if path.extension().and_then(|e| e.to_str()) == Some("db") {
        let (m, s) = stat(&companion_path(path, "-wal"));
        mtime += m;
        size += s;
    }
    (mtime, size)
}

/// Dispatches to the right parser for `agent`, logging (debug builds only)
/// and returning `None` on a file mid-write or genuinely malformed input —
/// never treated as a hard error, since the source files are outside our
/// control. Shared by `sync_file` and `sync_file_unlocked` so the two don't
/// duplicate the dispatch table.
fn parse_meta(agent: &'static str, path: &Path) -> Option<ParsedSession> {
    let parsed = match agent {
        "claude" => claude::parse_claude_meta(path),
        "codex" => codex::parse_codex_meta(path),
        "antigravity" => antigravity::parse_antigravity_meta(path),
        _ => None,
    };
    if parsed.is_none() {
        #[cfg(debug_assertions)]
        eprintln!("sessions_index: could not parse {agent} session at {}", path.display());
    }
    parsed
}

/// Upserts `session`, logging (debug builds only) and returning `false`
/// instead of propagating on a write failure — same never-a-hard-error
/// stance as `parse_meta`. Shared by `sync_file` and `sync_file_unlocked`.
fn commit(index: &Index, session: &ParsedSession, file_path: &str, mtime: i64, size: i64) -> bool {
    match index.upsert_session(session, file_path, mtime, size) {
        Ok(()) => true,
        Err(err) => {
            #[cfg(debug_assertions)]
            eprintln!("sessions_index: failed to upsert {file_path}: {err}");
            false
        }
    }
}

/// Re-parse and upsert one session file if its fingerprint changed since the
/// last sync. Returns `true` when something was upserted; `false` when the
/// cached fingerprint already matched (skip, the common case on a debounced
/// re-scan) or when parsing failed / found no session.
///
/// Takes an already-open `&Index` and does its own locking-free work in one
/// shot — fine for a caller syncing a single file under a lock it already
/// holds. Every production caller now loops over many files, so they use
/// `sync_file_unlocked` instead (it never holds the lock while parsing);
/// this stays as the simplest primitive to unit-test the check/parse/upsert
/// semantics against, decoupled from locking.
#[allow(dead_code)]
pub fn sync_file(index: &Index, agent: &'static str, path: &Path) -> bool {
    let (mtime, size) = fingerprint(path);
    let file_path = path.to_string_lossy().into_owned();
    if !index.needs_sync(&file_path, mtime, size) {
        return false;
    }
    let Some(session) = parse_meta(agent, path) else { return false };
    commit(index, &session, &file_path, mtime, size)
}

/// Same contract as `sync_file`, but for a caller that holds the index
/// behind a shared `Mutex` and is syncing many files in a row (a full sync
/// or a watcher batch): the `needs_sync` check and the final upsert each
/// take (and immediately release) the lock on their own, so parsing —
/// which can take real time on a multi-MB transcript — never happens while
/// the lock is held. That keeps `sessions_list` (which just needs a quick
/// lock+query) from ever blocking behind a bulk parse.
pub fn sync_file_unlocked(index: &Mutex<Index>, agent: &'static str, path: &Path) -> bool {
    let (mtime, size) = fingerprint(path);
    let file_path = path.to_string_lossy().into_owned();
    let needs = index.lock().unwrap().needs_sync(&file_path, mtime, size);
    if !needs {
        return false;
    }
    let Some(session) = parse_meta(agent, path) else { return false };
    let guard = index.lock().unwrap();
    commit(&guard, &session, &file_path, mtime, size)
}

/// Full reconciliation: discover every session file under `home` (honoring
/// the real process env's `CLAUDE_CONFIG_DIR`/`CODEX_HOME`/
/// `ANTIGRAVITY_CLI_DIR` overrides), sync each one, then prune index rows
/// whose source file no longer exists on disk. Returns how many files were
/// actually re-synced (upserted) — unchanged files that were skipped do not
/// count. This is the entry point used at app startup and is not itself
/// unit-tested against real env (see `sync_and_prune`, its hermetic core,
/// exercised in tests via `scanner::discover_from_roots` instead).
///
/// Takes `&Mutex<Index>` rather than `&Index` on purpose: on a machine with
/// years of history this walks and re-parses every session file, which can
/// take a while, and it must never hold the lock for that whole run — doing
/// so would block `sessions_list` (and therefore the UI) until the entire
/// sync finished. Discovery itself needs no lock at all; each file is then
/// synced via `sync_file_unlocked`, which locks only for its brief
/// check-then-commit steps.
pub fn full_sync(index: &Mutex<Index>, home: &Path) -> usize {
    sync_and_prune(index, scanner::discover(home))
}

/// The pure core of `full_sync`, decoupled from discovery so it can be
/// exercised in tests against an arbitrary hand-built file list without
/// depending on (or mutating) the real `CLAUDE_CONFIG_DIR`/`CODEX_HOME`/
/// `ANTIGRAVITY_CLI_DIR` process env.
fn sync_and_prune(index: &Mutex<Index>, files: Vec<scanner::SessionFile>) -> usize {
    let existing: HashSet<String> = files.iter().map(|f| f.path.to_string_lossy().into_owned()).collect();
    let dirty = files.iter().filter(|f| sync_file_unlocked(index, f.agent, &f.path)).count();
    // Short lock, taken only after every file has already been synced.
    let _ = index.lock().unwrap().prune_missing(&existing);
    dirty
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::sessions_index::scanner::{discover_from_roots, roots, SessionFile};
    use std::sync::Arc;

    /// Discovers under `home` without ever touching the real
    /// `CLAUDE_CONFIG_DIR`/`CODEX_HOME`/`ANTIGRAVITY_CLI_DIR` process env,
    /// mirroring scanner.rs's own hermetic tests. `full_sync` itself (the
    /// public, env-backed entry point) is exercised indirectly through
    /// `sync_and_prune`, its pure core.
    fn discover_hermetic(home: &Path) -> Vec<SessionFile> {
        discover_from_roots(&roots(home, Some(""), Some(""), Some("")))
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tt-sync-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, contents: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    /// A minimal single-line Claude Code transcript: one countable user
    /// message, enough for `parse_claude_meta` to return `Some`. Mirrors the
    /// shape of claude.rs's own `BASIC` fixture (Task 3), just trimmed to one
    /// line since sync.rs only cares about the sync mechanics, not the
    /// parser's own DAG-walking rules.
    fn claude_line(session_id: &str, text: &str) -> String {
        format!(
            r#"{{"type":"user","uuid":"u1","parentUuid":null,"sessionId":"{session_id}","cwd":"/p/alpha","timestamp":"2026-07-06T01:00:00.000Z","message":{{"role":"user","content":[{{"type":"text","text":"{text}"}}]}}}}"#
        )
    }

    fn claude_two_lines(session_id: &str) -> String {
        format!(
            "{}\n{}\n",
            claude_line(session_id, "hello"),
            concat!(
                r#"{"type":"assistant","uuid":"a1","parentUuid":"u1","timestamp":"2026-07-06T01:00:05.000Z","#,
                r#""message":{"role":"assistant","model":"claude-sonnet-5","content":[{"type":"text","text":"hi"}],"usage":{"output_tokens":7}}}"#
            ),
        )
    }

    // --- sync_file: skip / re-sync semantics --------------------------------

    #[test]
    fn sync_file_first_call_upserts_and_is_listed() {
        let dir = temp_dir("first");
        let index = Index::open(&dir.join("index.db")).unwrap();
        let path = dir.join("sess-1.jsonl");
        write(&path, &format!("{}\n", claude_line("sess-1", "hello")));

        assert!(sync_file(&index, "claude", &path));
        let rows = index.list();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "sess-1");
        assert_eq!(rows[0].message_count, 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sync_file_without_changes_is_skipped() {
        let dir = temp_dir("skip");
        let index = Index::open(&dir.join("index.db")).unwrap();
        let path = dir.join("sess-1.jsonl");
        write(&path, &format!("{}\n", claude_line("sess-1", "hello")));

        assert!(sync_file(&index, "claude", &path));
        // Same fingerprint (file untouched): the cache short-circuits.
        assert!(!sync_file(&index, "claude", &path));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn touching_the_file_triggers_a_re_sync() {
        let dir = temp_dir("touch");
        let index = Index::open(&dir.join("index.db")).unwrap();
        let path = dir.join("sess-1.jsonl");
        write(&path, &format!("{}\n", claude_line("sess-1", "hello")));
        assert!(sync_file(&index, "claude", &path));
        assert_eq!(index.list()[0].message_count, 1);

        // Rewrite with one more line: size changes, so the fingerprint
        // changes regardless of filesystem mtime resolution.
        write(&path, &claude_two_lines("sess-1"));
        assert!(sync_file(&index, "claude", &path));
        let rows = index.list();
        assert_eq!(rows.len(), 1); // same id: replaced, not duplicated
        assert_eq!(rows[0].message_count, 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sync_file_skips_gracefully_on_a_missing_file() {
        let dir = temp_dir("missing");
        let index = Index::open(&dir.join("index.db")).unwrap();
        let path = dir.join("does-not-exist.jsonl");

        assert!(!sync_file(&index, "claude", &path));
        assert!(index.list().is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sync_file_dispatches_by_agent() {
        let dir = temp_dir("dispatch");
        let index = Index::open(&dir.join("index.db")).unwrap();
        let path = dir.join("unknown.jsonl");
        write(&path, &claude_line("sess-1", "hello"));

        // An agent tag with no parser wired up never upserts.
        assert!(!sync_file(&index, "some-other-agent", &path));
        assert!(index.list().is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- sync_file_unlocked: same semantics, lock only held briefly --------

    #[test]
    fn sync_file_unlocked_matches_sync_file_semantics() {
        let dir = temp_dir("unlocked");
        let index = Mutex::new(Index::open(&dir.join("index.db")).unwrap());
        let path = dir.join("sess-1.jsonl");
        write(&path, &format!("{}\n", claude_line("sess-1", "hello")));

        // First call upserts...
        assert!(sync_file_unlocked(&index, "claude", &path));
        let rows = index.lock().unwrap().list();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "sess-1");
        assert_eq!(rows[0].message_count, 1);

        // ...an unchanged fingerprint on the next call is skipped, same as
        // sync_file, even though the check and the (skipped) commit are two
        // separate lock acquisitions here rather than one.
        assert!(!sync_file_unlocked(&index, "claude", &path));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sync_file_unlocked_never_holds_the_lock_while_parsing() {
        // A crude but real proof that sync_file_unlocked's needs_sync check
        // and its commit are each their own critical section: acquire the
        // lock from this thread, spawn a sync in the background (which must
        // block on the very first `needs_sync` call), then release — the
        // background sync should complete promptly once released, rather
        // than requiring the whole file to already have been parsed before
        // it could even ask for the lock.
        let dir = temp_dir("no-hold");
        let index = Arc::new(Mutex::new(Index::open(&dir.join("index.db")).unwrap()));
        let path = dir.join("sess-1.jsonl");
        write(&path, &format!("{}\n", claude_line("sess-1", "hello")));

        let guard = index.lock().unwrap();
        let index_bg = Arc::clone(&index);
        let path_bg = path.clone();
        let handle = std::thread::spawn(move || sync_file_unlocked(&index_bg, "claude", &path_bg));

        // Give the background thread a moment to reach (and block on) the
        // lock, then release it — if sync_file_unlocked tried to parse
        // before acquiring the lock, this ordering wouldn't matter either
        // way, but it does prove the call doesn't deadlock or require the
        // lock for longer than this brief hold.
        std::thread::sleep(std::time::Duration::from_millis(20));
        drop(guard);

        assert!(handle.join().unwrap());
        assert_eq!(index.lock().unwrap().list().len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- fingerprint: db + wal/shm companion summation ----------------------

    #[test]
    fn fingerprint_of_a_plain_file_ignores_unrelated_siblings() {
        let dir = temp_dir("fp-plain");
        let path = dir.join("sess.jsonl");
        write(&path, "abcd"); // 4 bytes
        // A sibling that merely happens to share a prefix must not be folded
        // in: only exact ".db" files look at companions at all.
        write(&path.with_extension("jsonl-wal"), "zzzzzzzzzz");

        let (_, size) = fingerprint(&path);
        assert_eq!(size, 4);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fingerprint_of_a_db_with_no_companions_is_just_its_own_size() {
        let dir = temp_dir("fp-db-alone");
        let path = dir.join("convo.db");
        write(&path, "abcdefgh"); // 8 bytes, no -wal/-shm present

        let (_, size) = fingerprint(&path);
        assert_eq!(size, 8);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fingerprint_of_a_db_sums_only_the_wal_companion() {
        let dir = temp_dir("fp-db-companions");
        let path = dir.join("convo.db");
        write(&path, "aaaa"); // 4
        write(&dir.join("convo.db-wal"), "bb"); // 2
        write(&dir.join("convo.db-shm"), "c"); // 1 — must NOT be folded in

        let (_, size) = fingerprint(&path);
        assert_eq!(size, 6);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fingerprint_is_stable_across_shm_only_touches() {
        // Opening a WAL-mode SQLite database — even read-only, as our own
        // parser does — touches the -shm file. If that moved the fingerprint,
        // every re-parse would schedule the next one: a self-sustaining sync
        // loop (observed in the field as a 500 ms watch-batch heartbeat).
        let dir = temp_dir("fp-shm-only");
        let path = dir.join("convo.db");
        write(&path, "aaaa");
        write(&dir.join("convo.db-wal"), "bb");
        write(&dir.join("convo.db-shm"), "c");
        let before = fingerprint(&path);

        write(&dir.join("convo.db-shm"), "cccccccc"); // grew; db + wal untouched
        let after = fingerprint(&path);

        assert_eq!(before, after);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fingerprint_changes_on_a_wal_only_commit() {
        // Antigravity CLI can append to the WAL without checkpointing it back
        // into the main .db file; the fingerprint must still move so
        // sync_file re-parses instead of trusting a stale cache.
        let dir = temp_dir("fp-wal-only");
        let path = dir.join("convo.db");
        write(&path, "aaaa");
        write(&dir.join("convo.db-wal"), "b");
        let before = fingerprint(&path);

        write(&dir.join("convo.db-wal"), "bbbbbbbbbb"); // grew, main db untouched
        let after = fingerprint(&path);

        assert_ne!(before, after);

        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- full_sync: discover + sync + prune ---------------------------------

    #[test]
    fn full_sync_indexes_discovered_files_and_prunes_deleted_ones() {
        let home = temp_dir("full-sync-home");
        let session_a = home.join(".claude/projects/projA/session1.jsonl");
        let session_b = home.join(".claude/projects/projB/session2.jsonl");
        write(&session_a, &format!("{}\n", claude_line("sess-a", "hello a")));
        write(&session_b, &format!("{}\n", claude_line("sess-b", "hello b")));

        let index = Mutex::new(Index::open(&home.join("index.db")).unwrap());

        let dirty = sync_and_prune(&index, discover_hermetic(&home));
        assert_eq!(dirty, 2);
        let ids: HashSet<String> = index.lock().unwrap().list().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, HashSet::from(["sess-a".to_string(), "sess-b".to_string()]));

        // Re-running with nothing changed on disk re-syncs nothing.
        assert_eq!(sync_and_prune(&index, discover_hermetic(&home)), 0);

        // Delete one source file and re-sync: its session disappears, the
        // other survives.
        std::fs::remove_file(&session_b).unwrap();
        let dirty = sync_and_prune(&index, discover_hermetic(&home));
        assert_eq!(dirty, 0); // nothing new to parse, only a prune
        let ids: HashSet<String> = index.lock().unwrap().list().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, HashSet::from(["sess-a".to_string()]));

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn full_sync_picks_up_a_newly_added_file_on_the_next_run() {
        let home = temp_dir("full-sync-add");
        let session_a = home.join(".claude/projects/projA/session1.jsonl");
        write(&session_a, &format!("{}\n", claude_line("sess-a", "hello a")));
        let index = Mutex::new(Index::open(&home.join("index.db")).unwrap());

        assert_eq!(sync_and_prune(&index, discover_hermetic(&home)), 1);

        let session_c = home.join(".claude/projects/projC/session3.jsonl");
        write(&session_c, &format!("{}\n", claude_line("sess-c", "hello c")));
        assert_eq!(sync_and_prune(&index, discover_hermetic(&home)), 1);
        assert_eq!(index.lock().unwrap().list().len(), 2);

        let _ = std::fs::remove_dir_all(&home);
    }
}
