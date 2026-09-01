//! In-process recovery state for a WebView reload.
//!
//! Terminal processes live in Rust, so a renderer reload must not be treated as
//! an application restart. This module keeps the small amount of volatile UI
//! state that cannot safely be written to disk (notably dirty editor buffers),
//! records privacy-preserving incidents, and reloads one workspace WebView.

use std::collections::HashMap;
#[cfg(any(target_os = "macos", test))]
use std::collections::VecDeque;
use std::path::PathBuf;
#[cfg(any(target_os = "macos", test))]
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};
#[cfg(target_os = "macos")]
use tauri::Window;
#[cfg(target_os = "macos")]
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const MAX_BUFFER_BYTES: usize = 8 * 1024 * 1024;
const MAX_WINDOW_BYTES: usize = 32 * 1024 * 1024;
#[cfg(any(target_os = "macos", test))]
const CRASH_RELOAD_WINDOW_MS: u64 = 30_000;
#[cfg(any(target_os = "macos", test))]
const CRASH_RELOAD_LIMIT: usize = 3;

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
    #[cfg(any(target_os = "macos", test))]
    recent_crashes: Mutex<HashMap<String, VecDeque<u64>>>,
    #[cfg(any(target_os = "macos", test))]
    log_write_lock: Arc<Mutex<()>>,
}

impl RecoveryState {
    pub fn new() -> Self {
        let now = timestamp_ms();
        Self {
            runtime_id: format!("{}-{now}", std::process::id()),
            snapshots: Mutex::new(HashMap::new()),
            notices: Mutex::new(HashMap::new()),
            log_path: Mutex::new(None),
            #[cfg(any(target_os = "macos", test))]
            recent_crashes: Mutex::new(HashMap::new()),
            #[cfg(any(target_os = "macos", test))]
            log_write_lock: Arc::new(Mutex::new(())),
        }
    }

    /// Records a renderer crash and returns whether an automatic reload is
    /// still allowed. The third crash within the rolling window is stopped so
    /// a persistently broken renderer cannot enter an infinite reload loop.
    #[cfg(any(target_os = "macos", test))]
    pub fn record_web_content_termination(&self, window_label: &str) -> bool {
        let now = timestamp_ms();
        let should_reload = {
            let mut crashes = self.recent_crashes.lock().unwrap();
            register_crash(crashes.entry(window_label.to_string()).or_default(), now)
        };
        self.record_incident(window_label, "web-content-terminated", now);
        should_reload
    }

    #[cfg(any(target_os = "macos", test))]
    fn record_incident(&self, window_label: &str, reason: &str, now: u64) {
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
        self.write_incident_log(window_label.to_string(), reason.to_string(), now);
    }

    pub fn init_log_path(&self, path: PathBuf) {
        *self.log_path.lock().unwrap() = Some(path);
    }

    #[cfg(any(target_os = "macos", test))]
    fn write_incident_log(&self, window_label: String, reason: String, timestamp_ms: u64) {
        let Some(path) = self.log_path.lock().unwrap().clone() else {
            return;
        };
        let write_lock = Arc::clone(&self.log_write_lock);
        // This callback originates on AppKit's main thread. Keep all best-effort
        // filesystem work off it so recovery never makes the native UI hang.
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let _guard = write_lock.lock().unwrap();
            write_incident_log_file(&path, &window_label, &reason, timestamp_ms);
        });
    }
}

#[cfg(any(target_os = "macos", test))]
fn register_crash(history: &mut VecDeque<u64>, now: u64) -> bool {
    while history
        .front()
        .is_some_and(|timestamp| now.saturating_sub(*timestamp) >= CRASH_RELOAD_WINDOW_MS)
    {
        history.pop_front();
    }
    history.push_back(now);
    history.len() < CRASH_RELOAD_LIMIT
}

#[cfg(any(target_os = "macos", test))]
fn write_incident_log_file(
    path: &std::path::Path,
    window_label: &str,
    reason: &str,
    timestamp_ms: u64,
) {
    let cutoff = timestamp_ms.saturating_sub(30 * 24 * 60 * 60 * 1000);
    let mut entries: Vec<serde_json::Value> = std::fs::read_to_string(path)
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
        let boundary = text.as_bytes()[keep_from..]
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|n| keep_from + n + 1)
            .unwrap_or(text.len());
        text = text[boundary..].to_string();
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, text);
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

/// Ask before attempting another reload once automatic crash recovery has
/// reached its safety limit. `true` means the user explicitly chose to retry.
#[cfg(target_os = "macos")]
pub fn prompt_crash_reload(window: &Window) -> bool {
    let app = window.app_handle();
    let language = app
        .try_state::<crate::modules::exit_guard::ExitGuardState>()
        .map(|state| state.language())
        .unwrap_or_else(|| "en".to_string());
    let (title, message, retry, keep_open) = if language == "zh-TW" {
        (
            "TempoTerm 無法自動復原",
            "工作區在 30 秒內連續停止回應。為避免無限重新載入，TempoTerm 已暫停自動復原。您可以再試一次，或保留目前視窗。",
            "再試一次",
            "保留視窗",
        )
    } else {
        (
            "TempoTerm could not recover automatically",
            "The workspace stopped responding repeatedly within 30 seconds. TempoTerm paused automatic recovery to prevent an infinite reload loop. You can try once more or keep the current window open.",
            "Try Again",
            "Keep Window Open",
        )
    };
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::OkCancelCustom(
            retry.to_string(),
            keep_open.to_string(),
        ))
        .parent(window)
        .blocking_show()
}

pub fn reload_workspace(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    close_owned_previews(app, window.label());
    window.reload().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn recovery_reload_window(window: WebviewWindow) -> Result<(), String> {
    reload_workspace(&window)
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

    #[test]
    fn third_crash_inside_window_stops_automatic_reload() {
        let mut history = VecDeque::new();
        assert!(register_crash(&mut history, 1_000));
        assert!(register_crash(&mut history, 2_000));
        assert!(!register_crash(&mut history, 3_000));
    }

    #[test]
    fn crash_reload_limit_recovers_after_rolling_window() {
        let mut history = VecDeque::new();
        assert!(register_crash(&mut history, 1_000));
        assert!(register_crash(&mut history, 2_000));
        assert!(register_crash(&mut history, 31_000));
        assert_eq!(
            history.iter().copied().collect::<Vec<_>>(),
            vec![2_000, 31_000]
        );
    }

    #[test]
    fn crash_reload_limit_is_scoped_per_window() {
        let state = RecoveryState::new();
        assert!(state.record_web_content_termination("main"));
        assert!(state.record_web_content_termination("main"));
        assert!(!state.record_web_content_termination("main"));
        assert!(state.record_web_content_termination("win-2"));
    }
}
