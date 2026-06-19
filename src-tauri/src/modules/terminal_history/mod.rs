//! Persisted terminal scrollback. Each pane's serialized buffer is stored as a
//! single file named by its (stable) UI leaf id, overwritten on each snapshot,
//! and deleted when the pane is closed or its shell exits. On next launch the
//! saved buffer is shown as read-only history above a fresh shell.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const DIR_NAME: &str = "terminal-history";

/// Leaf ids come from our own `uid()` generator, but treat them as untrusted
/// since they become file names: only allow characters that cannot escape the
/// history directory.
fn is_safe_leaf_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn history_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn history_file(app: &AppHandle, leaf_id: &str) -> Result<PathBuf, String> {
    if !is_safe_leaf_id(leaf_id) {
        return Err("invalid leaf id".to_string());
    }
    Ok(history_dir(app)?.join(format!("{leaf_id}.txt")))
}

#[tauri::command]
pub fn terminal_history_save(app: AppHandle, leaf_id: String, contents: String) -> Result<(), String> {
    let path = history_file(&app, &leaf_id)?;
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_history_load(app: AppHandle, leaf_id: String) -> Result<Option<String>, String> {
    let path = history_file(&app, &leaf_id)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn terminal_history_delete(app: AppHandle, leaf_id: String) -> Result<(), String> {
    let path = history_file(&app, &leaf_id)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Remove every saved history file (the manual "clear" action in settings).
#[tauri::command]
pub fn terminal_history_clear(app: AppHandle) -> Result<(), String> {
    let dir = history_dir(&app)?;
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let _ = fs::remove_file(entry.path());
    }
    Ok(())
}

/// Delete saved files for panes that no longer exist (orphans), keeping only the
/// given leaf ids. Called on startup with the panes still in the layout tree.
#[tauri::command]
pub fn terminal_history_prune(app: AppHandle, keep: Vec<String>) -> Result<(), String> {
    let dir = history_dir(&app)?;
    let keep: std::collections::HashSet<String> = keep.into_iter().collect();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            if !keep.contains(stem) {
                let _ = fs::remove_file(&path);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_safe_leaf_id;

    #[test]
    fn accepts_generated_ids_and_rejects_path_escapes() {
        assert!(is_safe_leaf_id("pane-1a2b3c"));
        assert!(is_safe_leaf_id("pane_42"));
        assert!(!is_safe_leaf_id("../secret"));
        assert!(!is_safe_leaf_id("a/b"));
        assert!(!is_safe_leaf_id(""));
    }
}
