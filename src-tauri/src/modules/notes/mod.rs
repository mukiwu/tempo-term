//! Watches the user's notes folder and tells the frontend when files change on
//! disk, e.g. a cloud drive (iCloud, Dropbox) syncing in edits from another
//! machine, so the notes view can reload. A single recursive watcher tracks the
//! currently chosen folder; replacing or clearing it drops the OS subscription.

use std::path::Path;
use std::sync::Mutex;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const NOTES_CHANGED_EVENT: &str = "notes-changed";

/// Payload emitted to the frontend: the absolute paths that changed.
#[derive(Clone, Serialize)]
struct NotesChanged {
    paths: Vec<String>,
}

/// Build a recursive watcher for the notes folder. Every filesystem event emits
/// the affected paths; the frontend debounces and decides what to reload.
fn build_watcher(app: &AppHandle, dir: &Path) -> Result<RecommendedWatcher, String> {
    let app_cb = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let event = match res {
            Ok(event) => event,
            Err(_) => return,
        };
        let paths: Vec<String> = event
            .paths
            .iter()
            .filter_map(|p| p.to_str().map(str::to_string))
            .collect();
        let _ = app_cb.emit(NOTES_CHANGED_EVENT, NotesChanged { paths });
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    Ok(watcher)
}

/// Holds the single active notes-folder watcher. Dropping it stops the OS-level
/// subscription.
pub struct NotesWatchState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl NotesWatchState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
        }
    }
}

impl Default for NotesWatchState {
    fn default() -> Self {
        Self::new()
    }
}

/// Start watching `path` (recursively), replacing any previous watcher.
#[tauri::command]
pub fn notes_watch(
    app: AppHandle,
    state: State<NotesWatchState>,
    path: String,
) -> Result<(), String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("{path} is not a directory"));
    }
    let watcher = build_watcher(&app, dir)?;
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

/// Stop watching the notes folder.
#[tauri::command]
pub fn notes_unwatch(state: State<NotesWatchState>) {
    *state.watcher.lock().unwrap() = None;
}
