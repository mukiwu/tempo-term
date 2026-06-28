//! Watches the files open in editor tabs and tells the frontend when one
//! changes on disk (e.g. an AI agent edits it), so the editor can reload without
//! the user closing and reopening the tab.
//!
//! Unlike the notes watcher (a single recursive folder), this tracks an
//! arbitrary set of open files. It subscribes to each file's parent directory
//! (non-recursive) — atomic saves (write temp + rename) surface as directory
//! events a per-file watch would miss — then filters events down to exactly the
//! tracked paths before notifying the frontend.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use notify::event::{EventKind, ModifyKind};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const EDITOR_FILE_CHANGED_EVENT: &str = "editor-file-changed";

/// Payload emitted to the frontend: the path that changed, in the exact form the
/// frontend originally sent (so its editor tab still matches).
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

/// Canonicalize a path for matching: resolves symlinks (macOS reports `/var/…`
/// as `/private/var/…`) and normalizes case (Windows) and separators, so a
/// watcher event lines up with the file we tracked. Falls back to the path as-is
/// when canonicalize fails — e.g. the file was just removed — so delete events
/// can still match.
fn canonical_key(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Holds the active watcher and the files it should report, keyed by canonical
/// path → the original path the frontend sent. Dropping the watcher stops the
/// OS-level subscription.
pub struct EditorWatchState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched: Arc<Mutex<HashMap<PathBuf, String>>>,
}

impl EditorWatchState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
            watched: Arc::new(Mutex::new(HashMap::new())),
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
    watched: Arc<Mutex<HashMap<PathBuf, String>>>,
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
        let map = watched.lock().unwrap();
        for path in &event.paths {
            // Match on the canonical key (notify reports canonical paths), but
            // emit the ORIGINAL path the frontend sent so its tab still matches.
            if let Some(original) = map.get(&canonical_key(path)) {
                let _ = app_cb.emit(
                    EDITOR_FILE_CHANGED_EVENT,
                    EditorFileChanged {
                        path: original.clone(),
                    },
                );
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
    {
        let mut map = state.watched.lock().unwrap();
        map.clear();
        // Key by canonical path (to match watcher events), value is the original
        // path the frontend sent (echoed back so its editor tab still matches).
        for path in &paths {
            map.insert(canonical_key(Path::new(path)), path.clone());
        }
    }
    if paths.is_empty() {
        *state.watcher.lock().unwrap() = None;
        return Ok(());
    }
    let mut watcher = build_watcher(&app, state.watched.clone())?;
    // Distinct parent dirs, so two files in the same folder share one watch.
    let mut dirs: HashSet<PathBuf> = HashSet::new();
    for path in &paths {
        if let Some(dir) = Path::new(path).parent() {
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

    #[test]
    fn canonical_key_falls_back_when_the_path_is_missing() {
        // A path that can't be canonicalized (doesn't exist) still needs a stable
        // key so delete events match; it falls back to the input unchanged.
        let missing = PathBuf::from("/no/such/dir/zzz_tempoterm_canon");
        assert_eq!(canonical_key(&missing), missing);
    }

    #[test]
    fn canonical_key_resolves_an_existing_path_to_an_absolute_real_path() {
        // An existing path canonicalizes to an absolute, real path (symlinks and
        // case resolved), which is what event matching keys on.
        let key = canonical_key(&std::env::temp_dir());
        assert!(key.is_absolute());
        assert!(key.exists());
    }
}
