//! In-process recovery state for a WebView reload.
//!
//! Terminal processes live in Rust, so a renderer reload must not be treated as
//! an application restart. This module keeps the small amount of volatile UI
//! state that cannot safely be written to disk (notably dirty editor buffers),
//! records privacy-preserving incidents, and reloads one workspace WebView.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

const MAX_BUFFER_BYTES: usize = 8 * 1024 * 1024;
const MAX_WINDOW_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSnapshotBuffer {
    pub path: String,
    pub content: String,
    pub baseline: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSnapshot {
    pub buffers: Vec<EditorSnapshotBuffer>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryNotice {
    pub incident_id: String,
    pub reason: String,
    pub timestamp_ms: u64,
    pub pty_sessions: usize,
    pub ssh_sessions: usize,
    pub output_truncated: bool,
}

pub struct RecoveryState {
    runtime_id: String,
    snapshots: Mutex<HashMap<String, EditorSnapshot>>,
    notices: Mutex<HashMap<String, RecoveryNotice>>,
    log_path: Mutex<Option<PathBuf>>,
}

impl RecoveryState {
    pub fn new() -> Self {
        let now = timestamp_ms();
        Self {
            runtime_id: format!("{}-{now}", std::process::id()),
            snapshots: Mutex::new(HashMap::new()),
            notices: Mutex::new(HashMap::new()),
            log_path: Mutex::new(None),
        }
    }

    pub fn record_incident(&self, window_label: &str, reason: &str) {
        let now = timestamp_ms();
        let notice = RecoveryNotice {
            incident_id: format!("{}-{now}", std::process::id()),
            reason: reason.to_string(),
            timestamp_ms: now,
            pty_sessions: 0,
            ssh_sessions: 0,
            output_truncated: false,
        };
        self.notices
            .lock()
            .unwrap()
            .insert(window_label.to_string(), notice);
        self.write_incident_log(window_label, reason, now);
    }

    pub fn init_log_path(&self, path: PathBuf) {
        *self.log_path.lock().unwrap() = Some(path);
    }

    fn write_incident_log(&self, window_label: &str, reason: &str, timestamp_ms: u64) {
        let Some(path) = self.log_path.lock().unwrap().clone() else {
            return;
        };
        let cutoff = timestamp_ms.saturating_sub(30 * 24 * 60 * 60 * 1000);
        let mut entries: Vec<serde_json::Value> = std::fs::read_to_string(&path)
            .ok()
            .into_iter()
            .flat_map(|text| {
                text.lines()
                    .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
                    .collect::<Vec<_>>()
            })
            .filter(|value| {
                value
                    .get("timestampMs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
                    >= cutoff
            })
            .collect();
        entries.push(serde_json::json!({
            "timestampMs": timestamp_ms,
            "reason": reason,
            // Window labels are application-generated (main/win-N), never user paths.
            "windowLabel": window_label,
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        }));
        if entries.len() > 200 {
            entries.drain(..entries.len() - 200);
        }
        let mut text = entries
            .into_iter()
            .filter_map(|entry| serde_json::to_string(&entry).ok())
            .collect::<Vec<_>>()
            .join("\n");
        text.push('\n');
        // The entry/count limits normally stay far below 1 MiB. Keep a final
        // byte guard so malformed legacy data can never grow the file forever.
        if text.len() > 1024 * 1024 {
            let keep_from = text.len() - 1024 * 1024;
            let boundary = text[keep_from..]
                .find('\n')
                .map(|n| keep_from + n + 1)
                .unwrap_or(keep_from);
            text = text[boundary..].to_string();
        }
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, text);
    }
}

fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn validate_snapshot(snapshot: &EditorSnapshot) -> Result<(), String> {
    let mut total = 0usize;
    for buffer in &snapshot.buffers {
        let bytes = buffer.content.len().saturating_add(buffer.baseline.len());
        if bytes > MAX_BUFFER_BYTES {
            return Err(format!(
                "editor buffer exceeds {} MiB recovery limit",
                MAX_BUFFER_BYTES / 1024 / 1024
            ));
        }
        total = total.saturating_add(bytes);
    }
    if total > MAX_WINDOW_BYTES {
        return Err(format!(
            "editor snapshot exceeds {} MiB recovery limit",
            MAX_WINDOW_BYTES / 1024 / 1024
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn runtime_instance_id(state: State<'_, RecoveryState>) -> String {
    state.runtime_id.clone()
}

#[tauri::command]
pub fn recovery_sync_editor_snapshot(
    window: WebviewWindow,
    state: State<'_, RecoveryState>,
    snapshot: EditorSnapshot,
) -> Result<(), String> {
    validate_snapshot(&snapshot)?;
    state
        .snapshots
        .lock()
        .unwrap()
        .insert(window.label().to_string(), snapshot);
    Ok(())
}

#[tauri::command]
pub fn recovery_take_editor_snapshot(
    window: WebviewWindow,
    state: State<'_, RecoveryState>,
) -> Option<EditorSnapshot> {
    state.snapshots.lock().unwrap().remove(window.label())
}

#[tauri::command]
pub fn recovery_take_notice(
    window: WebviewWindow,
    state: State<'_, RecoveryState>,
    pty_state: State<'_, crate::modules::pty::PtyState>,
    ssh_state: State<'_, crate::modules::ssh::SshState>,
) -> Option<RecoveryNotice> {
    // Deliberately non-destructive: React StrictMode and WebKit page lifecycle
    // can mount the recovery runtime more than once. The notice must remain
    // until the user explicitly dismisses it, not disappear on the first read.
    let mut notice = state.notices.lock().unwrap().get(window.label()).cloned()?;
    let (pty_sessions, pty_truncated) =
        crate::modules::pty::pty_recovery_stats(&pty_state, window.label());
    let (ssh_sessions, ssh_truncated) =
        crate::modules::ssh::ssh_recovery_stats(&ssh_state, window.label());
    notice.pty_sessions = pty_sessions;
    notice.ssh_sessions = ssh_sessions;
    notice.output_truncated = pty_truncated || ssh_truncated;
    Some(notice)
}

#[tauri::command]
pub fn recovery_dismiss_notice(window: WebviewWindow, state: State<'_, RecoveryState>) {
    state.notices.lock().unwrap().remove(window.label());
}

/// Close native preview children owned by `window_label`. They otherwise float
/// above a reloading main renderer and can make recovery appear to have failed.
pub fn close_owned_previews(app: &AppHandle, window_label: &str) {
    let prefix = format!("preview-{window_label}-");
    for (label, webview) in app.webviews() {
        if label.starts_with(&prefix) {
            let _ = webview.close();
        }
    }
}

pub fn reload_workspace(window: &WebviewWindow, reason: &str) -> Result<(), String> {
    let app = window.app_handle();
    if let Some(state) = app.try_state::<RecoveryState>() {
        state.record_incident(window.label(), reason);
    }
    close_owned_previews(app, window.label());
    window.reload().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn recovery_reload_window(window: WebviewWindow) -> Result<(), String> {
    reload_workspace(&window, "manual")
}

#[tauri::command]
pub fn recovery_reveal_log(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let log = dir.join("recovery-incidents.jsonl");
    tauri_plugin_opener::reveal_item_in_dir(if log.exists() { log } else { dir })
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_limits_are_enforced() {
        let ok = EditorSnapshot {
            buffers: vec![EditorSnapshotBuffer {
                path: "x".into(),
                content: "a".repeat(1024),
                baseline: String::new(),
            }],
        };
        assert!(validate_snapshot(&ok).is_ok());
        let too_large = EditorSnapshot {
            buffers: vec![EditorSnapshotBuffer {
                path: "x".into(),
                content: "a".repeat(MAX_BUFFER_BYTES + 1),
                baseline: String::new(),
            }],
        };
        assert!(validate_snapshot(&too_large).is_err());
    }
}
