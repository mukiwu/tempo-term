//! Historical AI CLI sessions: scans Claude Code / Codex / Antigravity CLI
//! session stores into a metadata-only SQLite index and serves the sidebar
//! sessions view. Message bodies are re-parsed from source files on demand —
//! the index is a disposable cache, the files stay the source of truth.

pub mod antigravity;
pub mod claude;
pub mod codex;
pub mod index;
pub mod proto;
pub mod scanner;
pub mod sync;
pub mod types;
pub mod watch;

use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, State};

use index::Index;
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
    // therefore the caller awaiting it) on that.
    let app_bg = app.clone();
    std::thread::spawn(move || {
        let count = {
            let index = index.lock().unwrap();
            sync::full_sync(&index, &home)
        };
        watch::emit_updated(&app_bg, count);
    });

    Ok(())
}

/// Every indexed session, newest-first, pinned sessions flagged. Empty
/// before `sessions_index_start` has run.
#[tauri::command]
pub fn sessions_list(state: State<SessionsIndexState>) -> Vec<SessionSummary> {
    let guard = state.inner.lock().unwrap();
    match guard.as_ref() {
        Some(inner) => inner.index.lock().unwrap().list(),
        None => Vec::new(),
    }
}

/// Re-parses a session's full transcript from its source file, for the
/// viewer. Never reads from the index (it stores metadata only).
#[tauri::command]
pub async fn sessions_get(state: State<'_, SessionsIndexState>, id: String) -> Result<Vec<TranscriptMessage>, String> {
    let lookup = {
        let guard = state.inner.lock().unwrap();
        let inner = guard.as_ref().ok_or_else(|| "sessions index not started".to_string())?;
        let result = inner.index.lock().unwrap().lookup_file(&id);
        result
    };
    let Some((agent, file_path)) = lookup else {
        return Ok(Vec::new());
    };

    // A transcript can be multiple MBs; parsing it must never run inline on
    // whatever thread is awaiting this command (see claude_session_title for
    // the same rationale).
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&file_path);
        match agent.as_str() {
            "claude" => claude::parse_claude_transcript(path),
            "codex" => codex::parse_codex_transcript(path),
            "antigravity" => antigravity::parse_antigravity_transcript(path),
            _ => Vec::new(),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Pin or unpin a session. Errors if the index hasn't been started yet.
#[tauri::command]
pub fn sessions_pin(state: State<SessionsIndexState>, id: String, pinned: bool) -> Result<(), String> {
    let guard = state.inner.lock().unwrap();
    let inner = guard.as_ref().ok_or_else(|| "sessions index not started".to_string())?;
    let result = inner.index.lock().unwrap().set_pinned(&id, pinned);
    result
}
