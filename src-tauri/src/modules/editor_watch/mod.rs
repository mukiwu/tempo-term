//! Watches the files open in editor tabs and tells the frontend when one
//! changes on disk (e.g. an AI agent edits it), so the editor can reload without
//! the user closing and reopening the tab.
//!
//! Unlike the notes watcher (a single recursive folder), this tracks an
//! arbitrary set of open files. It subscribes to each file's parent directory
//! (non-recursive) — atomic saves (write temp + rename) surface as directory
//! events a per-file watch would miss — then filters events down to exactly the
//! tracked paths before notifying the frontend.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use notify::event::{EventKind, ModifyKind};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const EDITOR_FILE_CHANGED_EVENT: &str = "editor-file-changed";

/// Payload emitted to the frontend: the absolute path that changed.
#[derive(Clone, Serialize)]
struct EditorFileChanged {
    path: String,
}

/// Whether a filesystem event should trigger a reload. We react to
/// content/structure changes but skip access and metadata-only events: reading a
/// file to reload it emits an access event, which would otherwise loop, and
/// mtime/atime touches are not real content changes.
fn is_interesting_change(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_)
    ) && !matches!(kind, EventKind::Modify(ModifyKind::Metadata(_)))
}

/// Holds the active watcher and the set of files it should report. Dropping the
/// watcher stops the OS-level subscription.
pub struct EditorWatchState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched: Arc<Mutex<HashSet<PathBuf>>>,
}

impl EditorWatchState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
            watched: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

impl Default for EditorWatchState {
    fn default() -> Self {
        Self::new()
    }
}

fn build_watcher(
    app: &AppHandle,
    watched: Arc<Mutex<HashSet<PathBuf>>>,
) -> Result<RecommendedWatcher, String> {
    let app_cb = app.clone();
    notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let event = match res {
            Ok(event) => event,
            Err(_) => return,
        };
        if !is_interesting_change(&event.kind) {
            return;
        }
        let set = watched.lock().unwrap();
        for path in &event.paths {
            if set.contains(path) {
                if let Some(s) = path.to_str() {
                    let _ = app_cb.emit(
                        EDITOR_FILE_CHANGED_EVENT,
                        EditorFileChanged {
                            path: s.to_string(),
                        },
                    );
                }
            }
        }
    })
    .map_err(|e| e.to_string())
}

/// Replace the set of watched editor files. Subscribes to each file's parent
/// directory (non-recursive) and filters events down to these paths. An empty
/// list drops the watcher entirely.
#[tauri::command]
pub fn editor_watch_set(
    app: AppHandle,
    state: State<EditorWatchState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let path_bufs: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    {
        let mut set = state.watched.lock().unwrap();
        set.clear();
        set.extend(path_bufs.iter().cloned());
    }
    if path_bufs.is_empty() {
        *state.watcher.lock().unwrap() = None;
        return Ok(());
    }
    let mut watcher = build_watcher(&app, state.watched.clone())?;
    // Distinct parent dirs, so two files in the same folder share one watch.
    let mut dirs: HashSet<PathBuf> = HashSet::new();
    for path in &path_bufs {
        if let Some(dir) = path.parent() {
            dirs.insert(dir.to_path_buf());
        }
    }
    for dir in dirs {
        // Ignore individual watch errors (permission denied, deleted directory,
        // disconnected drive) so the remaining open files are still watched.
        let _ = watcher.watch(&dir, RecursiveMode::NonRecursive);
    }
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, DataChange, MetadataKind, RemoveKind};

    #[test]
    fn reacts_to_content_and_structure_changes() {
        assert!(is_interesting_change(&EventKind::Create(CreateKind::Any)));
        assert!(is_interesting_change(&EventKind::Remove(RemoveKind::Any)));
        assert!(is_interesting_change(&EventKind::Modify(ModifyKind::Data(
            DataChange::Any
        ))));
    }

    #[test]
    fn ignores_access_and_metadata_events() {
        // Access events fire when we read the file to reload it; reacting loops.
        assert!(!is_interesting_change(&EventKind::Access(AccessKind::Any)));
        // Metadata-only touches (mtime/atime) are not real content changes.
        assert!(!is_interesting_change(&EventKind::Modify(
            ModifyKind::Metadata(MetadataKind::Any)
        )));
    }
}
