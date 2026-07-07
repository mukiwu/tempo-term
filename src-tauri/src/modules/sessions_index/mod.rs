//! Historical AI CLI sessions: scans Claude Code / Codex / Antigravity CLI
//! session stores into a metadata-only SQLite index and serves the sidebar
//! sessions view. Message bodies are re-parsed from source files on demand —
//! the index is a disposable cache, the files stay the source of truth.

pub mod antigravity;
pub mod claude;
pub mod codex;
pub mod export;
pub mod index;
pub mod proto;
pub mod scanner;
pub mod stats;
pub mod sync;
pub mod types;
pub mod watch;

use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, State};

use index::Index;
use stats::SessionsStats;
use types::{SessionSummary, TranscriptMessage};

/// The index's on-disk file, under the app's data directory.
const DB_FILE_NAME: &str = "sessions-index.db";

/// Everything that exists once `sessions_index_start` has run: the open
/// index and the live filesystem watchers keeping it in sync.
struct StateInner {
    index: Arc<Mutex<Index>>,
    /// Held only to keep the OS-level watch subscriptions alive for the
    /// app's lifetime; never read again after `sessions_index_start`.
    _watchers: Vec<notify::RecommendedWatcher>,
}

/// Lazily-started sessions index. `None` until `sessions_index_start` runs
/// (called once by the frontend when the sessions view first mounts); every
/// other command degrades gracefully (empty list / an error) until then.
pub struct SessionsIndexState {
    inner: Arc<Mutex<Option<StateInner>>>,
}

impl SessionsIndexState {
    pub fn new() -> Self {
        Self { inner: Arc::new(Mutex::new(None)) }
    }
}

impl Default for SessionsIndexState {
    fn default() -> Self {
        Self::new()
    }
}

/// Open the index, start the filesystem watchers, and kick off a background
/// full sync. No-op if already started — the frontend may call this more
/// than once (e.g. re-mounting the sessions view), and re-opening the same
/// DB file + re-watching the same roots would just duplicate watchers.
#[tauri::command]
pub fn sessions_index_start(app: AppHandle, state: State<SessionsIndexState>) -> Result<(), String> {
    let mut guard = state.inner.lock().unwrap();
    if guard.is_some() {
        return Ok(());
    }

    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join(DB_FILE_NAME);
    let index = Arc::new(Mutex::new(Index::open(&db_path)?));
    let home = app.path().home_dir().map_err(|e| e.to_string())?;

    let watchers = watch::start(&app, &home, Arc::clone(&index));
    *guard = Some(StateInner { index: Arc::clone(&index), _watchers: watchers });
    drop(guard); // release before the background thread might want it

    // A full sync walks every session file on disk, which can take a while
    // on a machine with years of history; never block this command (and
    // therefore the caller awaiting it) on that. `full_sync` itself never
    // holds `index`'s lock across that whole walk either — see its doc
    // comment — so `sessions_list` stays responsive on the main thread
    // while this background sync is still running.
    let app_bg = app.clone();
    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        eprintln!("[sessions] full sync: begin");
        let count = sync::full_sync(&index, &home);
        eprintln!("[sessions] full sync: {count} dirty in {:?}", started.elapsed());
        watch::emit_updated(&app_bg, count);
    });

    Ok(())
}

/// Every indexed session, newest-first, pinned sessions flagged. Empty
/// before `sessions_index_start` has run.
///
/// Async and offloaded to a blocking pool thread — mirrors `sessions_get`'s
/// rationale — so that even brief, incidental contention on the index lock
/// (e.g. the startup full sync mid-commit) never blocks the main thread the
/// IPC runtime would otherwise run this on. Returns `Result` only because
/// Tauri requires it of async commands taking a `State` reference; the
/// error case here is just `spawn_blocking`'s own join failure, never a
/// real lookup failure (those already degrade to an empty `Vec`).
#[tauri::command]
pub async fn sessions_list(state: State<'_, SessionsIndexState>) -> Result<Vec<SessionSummary>, String> {
    let index = {
        let guard = state.inner.lock().unwrap();
        guard.as_ref().map(|inner| Arc::clone(&inner.index))
    };
    let Some(index) = index else {
        return Ok(Vec::new());
    };
    tauri::async_runtime::spawn_blocking(move || index.lock().unwrap().list())
        .await
        .map_err(|e| e.to_string())
}

/// Re-parses a session's full transcript from its source file, for the
/// viewer. Never reads from the index (it stores metadata only).
#[tauri::command]
pub async fn sessions_get(state: State<'_, SessionsIndexState>, id: String) -> Result<Vec<TranscriptMessage>, String> {
    let started = std::time::Instant::now();
    eprintln!("[sessions] get {id}: begin");
    let index = {
        let guard = state.inner.lock().unwrap();
        let inner = guard.as_ref().ok_or_else(|| "sessions index not started".to_string())?;
        Arc::clone(&inner.index)
    };

    // Both the id lookup and the transcript parse run on a blocking-pool
    // thread: the lookup so this async worker never parks on the index
    // mutex while a sync batch holds it, and the parse because a transcript
    // can be multiple MBs (see claude_session_title for the same rationale).
    let result = tauri::async_runtime::spawn_blocking(move || {
        let lookup = index.lock().unwrap().lookup_file(&id);
        let Some((agent, file_path)) = lookup else {
            eprintln!("[sessions] get {id}: not in index");
            return Vec::new();
        };
        let path = Path::new(&file_path);
        match agent.as_str() {
            "claude" => claude::parse_claude_transcript(path),
            "codex" => codex::parse_codex_transcript(path),
            "antigravity" => antigravity::parse_antigravity_transcript(path),
            _ => Vec::new(),
        }
    })
    .await
    .map_err(|e| e.to_string());
    match &result {
        Ok(messages) => eprintln!(
            "[sessions] get: {} messages in {:?}",
            messages.len(),
            started.elapsed()
        ),
        Err(err) => eprintln!("[sessions] get: error after {:?}: {err}", started.elapsed()),
    }
    result
}

/// Re-parses a session's transcript (same lookup + parse as `sessions_get`)
/// and renders it as a standalone Markdown string for the export button.
/// The frontend then hands this to a save dialog and writes it to disk —
/// this command only produces the content.
#[tauri::command]
pub async fn sessions_export(state: State<'_, SessionsIndexState>, id: String) -> Result<String, String> {
    let index = {
        let guard = state.inner.lock().unwrap();
        let inner = guard.as_ref().ok_or_else(|| "sessions index not started".to_string())?;
        Arc::clone(&inner.index)
    };

    // Lookup, parse, and render all run on a blocking-pool thread: the
    // lookup so this async worker never parks on the index mutex during a
    // background sync batch, and the parse for the same reason as
    // `sessions_get` (a transcript can be multiple MBs).
    tauri::async_runtime::spawn_blocking(move || {
        let summary = index
            .lock()
            .unwrap()
            .lookup_summary(&id)
            .ok_or_else(|| format!("session {id} not found"))?;
        let path = Path::new(&summary.file_path);
        let messages = match summary.agent.as_str() {
            "claude" => claude::parse_claude_transcript(path),
            "codex" => codex::parse_codex_transcript(path),
            "antigravity" => antigravity::parse_antigravity_transcript(path),
            _ => Vec::new(),
        };
        Ok(export::transcript_to_markdown(&summary, &messages))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Pin or unpin a session. Errors if the index hasn't been started yet.
#[tauri::command]
pub fn sessions_pin(state: State<SessionsIndexState>, id: String, pinned: bool) -> Result<(), String> {
    let guard = state.inner.lock().unwrap();
    let inner = guard.as_ref().ok_or_else(|| "sessions index not started".to_string())?;
    let result = inner.index.lock().unwrap().set_pinned(&id, pinned);
    result
}

/// Move a path to the OS trash. Thin, deliberately-untested wrapper around
/// the `trash` crate, kept as its own function for the same reason as
/// `fs::ops::delete`: the real OS Trash API is not something a unit test
/// should exercise, so the pure logic around it (`sync::companion_paths`,
/// `Index::delete_session`) is tested instead and this stays a one-liner.
fn move_to_trash(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

/// Move a session's source file and its existing companions to the OS trash.
/// A source file that is already gone is a success, not an error — the row
/// is stale (the file was deleted externally) and the caller should still
/// clean up the index. The main file failing to trash is a hard error; a
/// companion failing is logged unconditionally (it's the only path where
/// data can be quietly orphaned) but never blocks removing the session.
fn trash_session_files(agent: &str, path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    move_to_trash(path)?;
    for companion in sync::companion_paths(agent, path) {
        if companion.exists() {
            if let Err(err) = move_to_trash(&companion) {
                eprintln!("sessions_index: failed to trash companion {}: {err}", companion.display());
            }
        }
    }
    Ok(())
}

/// Move a session's source file and its companions (a sibling
/// subagents/tool-results directory for Claude, `-wal`/`-shm` for
/// Antigravity) to the OS trash, then drop the session from the index and
/// emit `sessions-index:updated`. Never permanently deletes anything — trash
/// moves are always recoverable — and a missing companion (or an
/// already-missing source file) is skipped silently rather than treated as
/// an error.
#[tauri::command]
pub async fn sessions_delete(app: AppHandle, state: State<'_, SessionsIndexState>, id: String) -> Result<(), String> {
    let index = {
        let guard = state.inner.lock().unwrap();
        let inner = guard.as_ref().ok_or_else(|| "sessions index not started".to_string())?;
        Arc::clone(&inner.index)
    };

    // A single indexed SELECT, unlike sessions_get's full transcript parse,
    // so it's cheap enough to take the lock synchronously here rather than
    // on the blocking pool.
    let lookup = index.lock().unwrap().lookup_file(&id);
    let Some((agent, file_path)) = lookup else {
        return Err(format!("session {id} not found"));
    };

    // The trash calls can block on IPC to Finder (macOS) or the desktop
    // shell, so they run on a blocking-pool thread rather than the async
    // runtime's own worker threads.
    let trashed = tauri::async_runtime::spawn_blocking(move || {
        trash_session_files(&agent, Path::new(&file_path))
    })
    .await
    .map_err(|e| e.to_string())?;
    trashed?;

    index.lock().unwrap().delete_session(&id)?;
    watch::emit_updated(&app, 1);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A source file that is already gone (deleted externally, or a stale
    /// index row) counts as success: nothing to trash, but the caller should
    /// still drop the index row instead of erroring out and leaving the
    /// phantom session in the list. This test never touches the real OS
    /// trash — the path doesn't exist, so no trash call is ever made.
    #[test]
    fn trash_session_files_with_a_missing_source_file_is_a_success() {
        let path = std::env::temp_dir()
            .join(format!("tt-sessions-delete-missing-{}", std::process::id()))
            .join("gone.jsonl");
        assert!(trash_session_files("claude", &path).is_ok());
    }

    /// The command flow for a stale row, minus the Tauri plumbing: a session
    /// whose file no longer exists still gets its index rows removed.
    #[test]
    fn deleting_a_session_whose_file_is_gone_still_removes_the_row() {
        use crate::modules::sessions_index::types::ParsedSession;

        let dir = std::env::temp_dir().join(format!("tt-sessions-delete-stale-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let index = Index::open(&dir.join("index.db")).unwrap();
        let missing = dir.join("never-created.jsonl");
        let session = ParsedSession {
            id: "stale".into(),
            agent: "claude",
            project_cwd: "/p".into(),
            title: "t".into(),
            started_at: 0,
            ended_at: 0,
            message_count: 1,
            user_message_count: 1,
            output_tokens: None,
            model: None,
            activity: Vec::new(),
        };
        index.upsert_session(&session, &missing.to_string_lossy(), 1, 1).unwrap();

        assert!(trash_session_files("claude", &missing).is_ok());
        index.delete_session("stale").unwrap();

        assert!(index.list().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Dashboard aggregates (cards, heatmap, top sessions, weekly breakdown) for
/// sessions active in the last `days` local days (`None` = all time).
///
/// Async and offloaded to a blocking pool thread for the same reason as
/// `sessions_list`: several SQL aggregates run here, and none of them should
/// ever block the main thread on incidental lock contention with a
/// background sync. Degrades to zeroed stats — never an error — before
/// `sessions_index_start` has run.
#[tauri::command]
pub async fn sessions_stats(state: State<'_, SessionsIndexState>, days: Option<i64>) -> Result<SessionsStats, String> {
    let index = {
        let guard = state.inner.lock().unwrap();
        guard.as_ref().map(|inner| Arc::clone(&inner.index))
    };
    let Some(index) = index else {
        return Ok(stats::empty_stats());
    };
    tauri::async_runtime::spawn_blocking(move || index.lock().unwrap().stats(days))
        .await
        .map_err(|e| e.to_string())
}

/// Per-project aggregates + recent sessions for the project view. Offloaded to
/// a blocking pool thread like `sessions_stats`. Zeroed stats (never an error)
/// before the index has started or for an unknown project.
#[tauri::command]
pub async fn sessions_project_stats(
    state: State<'_, SessionsIndexState>,
    project_cwd: String,
) -> Result<stats::ProjectStats, String> {
    let index = {
        let guard = state.inner.lock().unwrap();
        guard.as_ref().map(|inner| Arc::clone(&inner.index))
    };
    let Some(index) = index else {
        return Ok(stats::ProjectStats {
            project_cwd,
            sessions: 0,
            messages: 0,
            output_tokens: 0,
            active_days: 0,
            top_model: None,
            first_at: 0,
            last_at: 0,
            recent: Vec::new(),
        });
    };
    tauri::async_runtime::spawn_blocking(move || index.lock().unwrap().project_stats(&project_cwd))
        .await
        .map_err(|e| e.to_string())
}
