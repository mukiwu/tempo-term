//! In-process recovery state for a WebView reload.
//!
//! Terminal processes live in Rust, so a renderer reload must not be treated as
//! an application restart. This module keeps the small amount of volatile UI
//! state that cannot safely be written to disk (notably dirty editor buffers),
//! records privacy-preserving incidents, and recreates one workspace window.

use std::collections::HashMap;
#[cfg(any(target_os = "macos", test))]
use std::collections::VecDeque;
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::sync::Arc;
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::{AppHandle, Manager, State, WebviewWindow};
#[cfg(target_os = "macos")]
use tauri::{RunEvent, WebviewWindowBuilder, Window};
#[cfg(target_os = "macos")]
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const MAX_BUFFER_BYTES: usize = 8 * 1024 * 1024;
const MAX_WINDOW_BYTES: usize = 32 * 1024 * 1024;
#[cfg(any(target_os = "macos", test))]
const REBUILD_WINDOW_MS: u64 = 120_000;
#[cfg(any(target_os = "macos", test))]
const REBUILD_LIMIT: usize = 3;
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
const HEARTBEAT_STALE_MS: u64 = 20_000;
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
const HEARTBEAT_PROBE_GRACE_MS: u64 = 3_000;
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
const WATCHDOG_SLEEP_GAP_MS: u64 = 8_000;

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
    recent_rebuilds: Mutex<HashMap<String, VecDeque<u64>>>,
    renderer_health: Mutex<HashMap<String, RendererHealth>>,
    #[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
    watchdog_last_tick_ms: Mutex<u64>,
    #[cfg(target_os = "macos")]
    log_write_lock: Arc<Mutex<()>>,
}

#[derive(Clone, Debug)]
struct RendererHealth {
    last_heartbeat_ms: u64,
    visible: bool,
    generation: u64,
    probe_started_ms: Option<u64>,
    rebuilding: bool,
    #[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
    paused: bool,
}

#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
#[derive(Debug, PartialEq, Eq)]
enum WatchdogAction {
    Probe(String),
    Rebuild(String),
}

#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
#[derive(Debug, PartialEq, Eq)]
enum BeginRebuild {
    Started(usize),
    Merged,
    LimitReached,
    Paused,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, PartialEq, Eq)]
enum RebuildFailureAction {
    Prompt,
    Restart,
}

#[cfg(any(target_os = "macos", test))]
fn rebuild_failure_action(has_window: bool) -> RebuildFailureAction {
    if has_window {
        RebuildFailureAction::Prompt
    } else {
        RebuildFailureAction::Restart
    }
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
            recent_rebuilds: Mutex::new(HashMap::new()),
            renderer_health: Mutex::new(HashMap::new()),
            watchdog_last_tick_ms: Mutex::new(now),
            #[cfg(target_os = "macos")]
            log_write_lock: Arc::new(Mutex::new(())),
        }
    }

    #[cfg(target_os = "macos")]
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
    }

    fn heartbeat(&self, window_label: &str, visible: bool, generation: u64, now: u64) -> u64 {
        let mut health = self.renderer_health.lock().unwrap();
        let entry = health
            .entry(window_label.to_string())
            .or_insert(RendererHealth {
                last_heartbeat_ms: now,
                visible,
                generation,
                probe_started_ms: None,
                rebuilding: false,
                paused: false,
            });
        if generation == 0 || generation == entry.generation {
            entry.last_heartbeat_ms = now;
            entry.visible = visible;
            entry.probe_started_ms = None;
        }
        entry.generation
    }

    fn renderer_ready(&self, window_label: &str, generation: u64, now: u64) -> u64 {
        let mut health = self.renderer_health.lock().unwrap();
        let entry = health
            .entry(window_label.to_string())
            .or_insert(RendererHealth {
                last_heartbeat_ms: now,
                visible: false,
                generation,
                probe_started_ms: None,
                rebuilding: false,
                paused: false,
            });
        if generation == 0 || generation == entry.generation {
            entry.last_heartbeat_ms = now;
            entry.probe_started_ms = None;
            entry.rebuilding = false;
        }
        entry.generation
    }

    #[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
    fn watchdog_actions(&self, now: u64) -> Vec<WatchdogAction> {
        let mut last_tick = self.watchdog_last_tick_ms.lock().unwrap();
        let woke_from_sleep = now.saturating_sub(*last_tick) > WATCHDOG_SLEEP_GAP_MS;
        *last_tick = now;
        let mut health = self.renderer_health.lock().unwrap();
        if woke_from_sleep {
            for entry in health.values_mut() {
                entry.last_heartbeat_ms = now;
                entry.probe_started_ms = None;
            }
            return Vec::new();
        }
        let mut actions = Vec::new();
        for (label, entry) in health.iter_mut() {
            if !entry.visible || entry.rebuilding || entry.paused {
                entry.probe_started_ms = None;
                continue;
            }
            if now.saturating_sub(entry.last_heartbeat_ms) < HEARTBEAT_STALE_MS {
                entry.probe_started_ms = None;
                continue;
            }
            match entry.probe_started_ms {
                None => {
                    entry.probe_started_ms = Some(now);
                    actions.push(WatchdogAction::Probe(label.clone()));
                }
                Some(started) if now.saturating_sub(started) >= HEARTBEAT_PROBE_GRACE_MS => {
                    actions.push(WatchdogAction::Rebuild(label.clone()));
                }
                Some(_) => {}
            }
        }
        actions
    }

    #[cfg(any(target_os = "macos", test))]
    fn begin_rebuild(&self, window_label: &str, automatic: bool, now: u64) -> BeginRebuild {
        let mut health = self.renderer_health.lock().unwrap();
        let entry = health
            .entry(window_label.to_string())
            .or_insert(RendererHealth {
                last_heartbeat_ms: now,
                visible: true,
                generation: 0,
                probe_started_ms: None,
                rebuilding: false,
                paused: false,
            });
        if automatic && entry.paused {
            return BeginRebuild::Paused;
        }
        if !automatic {
            entry.paused = false;
        }
        if entry.rebuilding {
            return BeginRebuild::Merged;
        }
        let attempt = if automatic {
            let mut attempts = self.recent_rebuilds.lock().unwrap();
            let history = attempts.entry(window_label.to_string()).or_default();
            if !register_rebuild(history, now) {
                entry.paused = true;
                return BeginRebuild::LimitReached;
            }
            history.len()
        } else {
            1
        };
        entry.rebuilding = true;
        entry.probe_started_ms = None;
        BeginRebuild::Started(attempt)
    }

    #[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
    fn finish_rebuild(&self, window_label: &str, success: bool, now: u64) -> u64 {
        let mut health = self.renderer_health.lock().unwrap();
        let entry = health
            .entry(window_label.to_string())
            .or_insert(RendererHealth {
                last_heartbeat_ms: now,
                visible: true,
                generation: 0,
                probe_started_ms: None,
                rebuilding: false,
                paused: false,
            });
        if success {
            entry.generation = entry.generation.saturating_add(1);
            entry.last_heartbeat_ms = now;
            // Keep the replacement renderer under observation even before its
            // first heartbeat. If navigation or frontend bootstrap hangs after
            // the native WebView was created, the watchdog must still recover
            // it instead of treating creation itself as readiness.
            entry.visible = true;
        }
        entry.rebuilding = false;
        entry.generation
    }

    #[cfg(any(target_os = "macos", test))]
    fn is_rebuilding(&self) -> bool {
        self.renderer_health
            .lock()
            .unwrap()
            .values()
            .any(|entry| entry.rebuilding)
    }

    pub fn init_log_path(&self, path: PathBuf) {
        *self.log_path.lock().unwrap() = Some(path);
    }

    #[cfg(target_os = "macos")]
    fn write_incident_log(
        &self,
        window_label: String,
        reason: String,
        stage: String,
        outcome: String,
        attempt: usize,
        duration_ms: u64,
        timestamp_ms: u64,
    ) {
        let Some(path) = self.log_path.lock().unwrap().clone() else {
            return;
        };
        let write_lock = Arc::clone(&self.log_write_lock);
        // This callback originates on AppKit's main thread. Keep all best-effort
        // filesystem work off it so recovery never makes the native UI hang.
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let _guard = write_lock.lock().unwrap();
            write_incident_log_file(
                &path,
                &window_label,
                &reason,
                &stage,
                &outcome,
                attempt,
                duration_ms,
                timestamp_ms,
            );
        });
    }
}

/// Destroying the sole `WebviewWindow` normally asks Tauri to exit the whole
/// process. A same-label replacement necessarily has a short interval with no
/// workspace window, so keep the event loop alive for that interval. This is
/// what preserves Rust-owned PTY/SSH sessions while the native window and its
/// root WKWebView are recreated.
#[cfg(target_os = "macos")]
pub fn handle_run_event(app: &AppHandle, event: &RunEvent) {
    let RunEvent::ExitRequested { api, .. } = event else {
        return;
    };
    if app
        .try_state::<RecoveryState>()
        .is_some_and(|state| state.is_rebuilding())
    {
        api.prevent_exit();
    }
}

#[cfg(any(target_os = "macos", test))]
fn register_rebuild(history: &mut VecDeque<u64>, now: u64) -> bool {
    while history
        .front()
        .is_some_and(|timestamp| now.saturating_sub(*timestamp) >= REBUILD_WINDOW_MS)
    {
        history.pop_front();
    }
    if history.len() >= REBUILD_LIMIT {
        return false;
    }
    history.push_back(now);
    true
}

#[cfg(any(target_os = "macos", test))]
fn write_incident_log_file(
    path: &std::path::Path,
    window_label: &str,
    reason: &str,
    stage: &str,
    outcome: &str,
    attempt: usize,
    duration_ms: u64,
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
        "attempt": attempt,
        "stage": stage,
        "outcome": outcome,
        "durationMs": duration_ms,
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

fn reload_after_preview_cleanup<E>(
    close_previews: impl FnOnce(),
    reload: impl FnOnce() -> Result<(), E>,
) -> Result<(), E> {
    close_previews();
    reload()
}

pub fn reload_workspace(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    reload_after_preview_cleanup(
        || close_owned_previews(app, window.label()),
        || window.reload().map_err(|error| error.to_string()),
    )
}

/// Ask before attempting another rebuild once automatic recovery has
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
            "工作區在 2 分鐘內已自動重建 3 次。為避免無限循環，TempoTerm 已暫停自動復原。您可以再試一次，或保留目前視窗。",
            "再試一次",
            "保留視窗",
        )
    } else {
        (
            "TempoTerm could not recover automatically",
            "The workspace was rebuilt 3 times within 2 minutes. TempoTerm paused automatic recovery to prevent an infinite loop. You can try once more or keep the current window open.",
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

#[cfg(target_os = "macos")]
fn prompt_rebuild_failure(window: &Window) -> bool {
    let app = window.app_handle();
    let language = app
        .try_state::<crate::modules::exit_guard::ExitGuardState>()
        .map(|state| state.language())
        .unwrap_or_else(|| "en".to_string());
    let (title, message, retry, restart) = if language == "zh-TW" {
        (
            "TempoTerm 無法重建工作區",
            "原生視窗仍會保留。您可以再試一次，或重新啟動 App；重新啟動會結束目前執行中的 PTY 與 SSH 工作階段。",
            "再試一次",
            "重新啟動 App",
        )
    } else {
        (
            "TempoTerm could not rebuild the workspace",
            "The native window will remain open. You can try again or restart the app; restarting ends all running PTY and SSH sessions.",
            "Try Again",
            "Restart App",
        )
    };
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::OkCancelCustom(
            retry.to_string(),
            restart.to_string(),
        ))
        .parent(window)
        .blocking_show()
}

#[cfg(target_os = "macos")]
fn rebuild_webview(app: &AppHandle, window_label: &str) -> Result<(), String> {
    // Tauri's startup window is a WebviewWindow: its root WKWebView owns the
    // native content view. Closing only that root and adding a child can leave
    // an empty NSWindow even though add_child returned Ok. Rebuild the paired
    // WebviewWindow instead; destroy() emits no CloseRequested event, so the
    // Rust-owned PTY/SSH sessions are deliberately left untouched.
    let window = app
        .get_webview_window(window_label)
        .ok_or_else(|| format!("webview window {window_label} not found"))?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let size = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let was_visible = window.is_visible().unwrap_or(true);
    let was_focused = window.is_focused().unwrap_or(true);
    let was_maximized = window.is_maximized().unwrap_or(false);
    let was_fullscreen = window.is_fullscreen().unwrap_or(false);
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "main window configuration not found".to_string())?;
    config.label = window_label.to_string();
    config.center = false;
    config.x = Some(position.x);
    config.y = Some(position.y);
    config.width = size.width;
    config.height = size.height;
    // Build the replacement hidden and restore presentation only after the
    // terminated native surface is confirmed out of the window stack.
    config.visible = false;
    config.focus = false;
    config.maximized = was_maximized;
    config.fullscreen = was_fullscreen;
    close_owned_previews(app, window_label);

    // After a WebContent crash AppKit can keep the terminated NSWindow's last
    // surface on screen even after Tauri removes its registrations. Hide that
    // surface before destroy so it cannot occlude the healthy same-position
    // replacement. Capture visibility and focus above so the replacement still
    // restores the user's original window state.
    window.hide().map_err(|error| error.to_string())?;
    let hide_deadline = std::time::Instant::now() + Duration::from_secs(1);
    while window.is_visible().unwrap_or(false) {
        if std::time::Instant::now() >= hide_deadline {
            return Err(format!("window {window_label} hide timed out"));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    window.destroy().map_err(|error| error.to_string())?;
    // destroy() is queued onto AppKit's event loop. Wait until Tauri removes
    // both registrations before reusing the same label, otherwise the builder
    // can race with teardown and fail with LabelAlreadyExists.
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while app.get_window(window_label).is_some() || app.get_webview(window_label).is_some() {
        if std::time::Instant::now() >= deadline {
            return Err(format!("window {window_label} teardown timed out"));
        }
        std::thread::sleep(Duration::from_millis(10));
    }

    let replacement = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    if was_visible {
        replacement.show().map_err(|error| error.to_string())?;
    }
    if was_focused {
        replacement.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Coalesces concurrent recovery requests and performs WebView creation away
/// from AppKit's callback thread. The native window and all Rust-owned session
/// state stay alive while only the failed renderer is replaced.
#[cfg(target_os = "macos")]
pub fn schedule_rebuild(
    app: AppHandle,
    window_label: String,
    reason: &'static str,
    automatic: bool,
) -> Result<(), String> {
    let state = app
        .try_state::<RecoveryState>()
        .ok_or_else(|| "recovery state unavailable".to_string())?;
    let now = timestamp_ms();
    let attempt = match state.begin_rebuild(&window_label, automatic, now) {
        BeginRebuild::Started(attempt) => attempt,
        BeginRebuild::Merged => return Ok(()),
        BeginRebuild::Paused => return Ok(()),
        BeginRebuild::LimitReached => {
            state.write_incident_log(
                window_label.clone(),
                reason.to_string(),
                "rate-limit".to_string(),
                "stopped".to_string(),
                REBUILD_LIMIT + 1,
                0,
                now,
            );
            let window = app
                .get_window(&window_label)
                .ok_or_else(|| format!("window {window_label} not found"))?;
            std::thread::spawn(move || {
                if prompt_crash_reload(&window) {
                    let _ = schedule_rebuild(app, window_label, reason, false);
                }
            });
            return Ok(());
        }
    };
    state.record_incident(&window_label, reason, now);
    state.write_incident_log(
        window_label.clone(),
        reason.to_string(),
        "requested".to_string(),
        "started".to_string(),
        attempt,
        0,
        now,
    );
    std::thread::spawn(move || {
        let started = timestamp_ms();
        let result = rebuild_webview(&app, &window_label);
        let finished = timestamp_ms();
        if let Some(state) = app.try_state::<RecoveryState>() {
            state.finish_rebuild(&window_label, result.is_ok(), finished);
            state.write_incident_log(
                window_label.clone(),
                reason.to_string(),
                "webview-rebuild".to_string(),
                if result.is_ok() { "success" } else { "failure" }.to_string(),
                attempt,
                finished.saturating_sub(started),
                finished,
            );
        }
        if result.is_err() {
            let window = app.get_window(&window_label);
            match rebuild_failure_action(window.is_some()) {
                RebuildFailureAction::Prompt => {
                    let window = window.expect("rebuild failure window disappeared");
                    // The failed rebuild may have hidden the original window
                    // before returning. Make its recovery prompt visible.
                    let _ = window.show();
                    if prompt_rebuild_failure(&window) {
                        let _ = schedule_rebuild(app.clone(), window_label.clone(), reason, false);
                    } else {
                        app.request_restart();
                    }
                }
                // Once destroy() succeeded there is no native parent left for
                // a reliable error dialog, and another in-process rebuild
                // cannot inspect the old window configuration. Restart rather
                // than leaving a headless Rust process and stranded sessions.
                RebuildFailureAction::Restart => app.request_restart(),
            }
        }
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn schedule_rebuild(
    app: AppHandle,
    window_label: String,
    _reason: &'static str,
    _automatic: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&window_label)
        .ok_or_else(|| format!("webview window {window_label} not found"))?;
    reload_workspace(&window)
}

#[cfg(target_os = "macos")]
pub fn start_renderer_watchdog(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        loop {
            interval.tick().await;
            let actions = app
                .try_state::<RecoveryState>()
                .map(|state| state.watchdog_actions(timestamp_ms()))
                .unwrap_or_default();
            for action in actions {
                match action {
                    WatchdogAction::Probe(label) => {
                        let native_visible = app.get_window(&label).is_some_and(|window| {
                            window.is_visible().unwrap_or(false)
                                && !window.is_minimized().unwrap_or(false)
                        });
                        if !native_visible {
                            if let Some(state) = app.try_state::<RecoveryState>() {
                                state.heartbeat(&label, false, 0, timestamp_ms());
                            }
                            continue;
                        }
                        let _ = app.emit_to(&label, "recovery-renderer-probe", ());
                    }
                    WatchdogAction::Rebuild(label) => {
                        let native_visible = app.get_window(&label).is_some_and(|window| {
                            window.is_visible().unwrap_or(false)
                                && !window.is_minimized().unwrap_or(false)
                        });
                        if !native_visible {
                            if let Some(state) = app.try_state::<RecoveryState>() {
                                state.heartbeat(&label, false, 0, timestamp_ms());
                            }
                            continue;
                        }
                        let _ = schedule_rebuild(app.clone(), label, "renderer-unresponsive", true);
                    }
                }
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn start_renderer_watchdog(_app: AppHandle) {}

#[tauri::command]
pub fn recovery_renderer_heartbeat(
    window: WebviewWindow,
    state: State<'_, RecoveryState>,
    visible: bool,
    generation: u64,
) -> u64 {
    state.heartbeat(window.label(), visible, generation, timestamp_ms())
}

#[tauri::command]
pub fn recovery_renderer_ready(
    window: WebviewWindow,
    state: State<'_, RecoveryState>,
    generation: u64,
) -> u64 {
    state.renderer_ready(window.label(), generation, timestamp_ms())
}

#[tauri::command]
pub fn recovery_rebuild_webview(
    window: WebviewWindow,
    app: AppHandle,
    reason: String,
) -> Result<(), String> {
    let reason = match reason.as_str() {
        "manual-reload" => "manual-reload",
        _ => "manual-recovery",
    };
    schedule_rebuild(app, window.label().to_string(), reason, false)
}

#[tauri::command]
pub fn recovery_reload_window(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    schedule_rebuild(app, window.label().to_string(), "manual-reload", false)
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
    use std::cell::RefCell;

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
    fn recovery_log_contains_only_operational_metadata() {
        let path = std::env::temp_dir().join(format!(
            "tempoterm-recovery-log-test-{}.jsonl",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        write_incident_log_file(
            &path,
            "main",
            "renderer-unresponsive",
            "webview-rebuild",
            "success",
            2,
            145,
            10_000,
        );
        let text = std::fs::read_to_string(&path).unwrap();
        let value: serde_json::Value = serde_json::from_str(text.trim()).unwrap();
        assert_eq!(value["reason"], "renderer-unresponsive");
        assert_eq!(value["stage"], "webview-rebuild");
        assert_eq!(value["outcome"], "success");
        assert_eq!(value["attempt"], 2);
        assert_eq!(value["durationMs"], 145);
        assert!(value.get("path").is_none());
        assert!(value.get("output").is_none());
        assert!(value.get("content").is_none());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn fourth_rebuild_inside_window_stops_automatic_recovery() {
        let mut history = VecDeque::new();
        assert!(register_rebuild(&mut history, 1_000));
        assert!(register_rebuild(&mut history, 2_000));
        assert!(register_rebuild(&mut history, 3_000));
        assert!(!register_rebuild(&mut history, 4_000));
    }

    #[test]
    fn crash_reload_limit_recovers_after_rolling_window() {
        let mut history = VecDeque::new();
        assert!(register_rebuild(&mut history, 1_000));
        assert!(register_rebuild(&mut history, 2_000));
        assert!(register_rebuild(&mut history, 121_000));
        assert_eq!(
            history.iter().copied().collect::<Vec<_>>(),
            vec![2_000, 121_000]
        );
    }

    #[test]
    fn rebuild_limit_and_in_flight_request_are_scoped_per_window() {
        let state = RecoveryState::new();
        assert_eq!(
            state.begin_rebuild("main", true, 1_000),
            BeginRebuild::Started(1)
        );
        assert_eq!(
            state.begin_rebuild("main", true, 1_001),
            BeginRebuild::Merged
        );
        state.finish_rebuild("main", false, 1_002);
        assert_eq!(
            state.begin_rebuild("main", true, 2_000),
            BeginRebuild::Started(2)
        );
        state.finish_rebuild("main", false, 2_001);
        assert_eq!(
            state.begin_rebuild("main", true, 3_000),
            BeginRebuild::Started(3)
        );
        state.finish_rebuild("main", false, 3_001);
        assert_eq!(
            state.begin_rebuild("main", true, 4_000),
            BeginRebuild::LimitReached
        );
        assert_eq!(
            state.begin_rebuild("main", true, 4_001),
            BeginRebuild::Paused
        );
        assert_eq!(
            state.begin_rebuild("main", false, 4_002),
            BeginRebuild::Started(1)
        );
        assert_eq!(
            state.begin_rebuild("win-2", true, 4_000),
            BeginRebuild::Started(1)
        );
    }

    #[test]
    fn watchdog_probes_then_rebuilds_only_visible_renderers() {
        let state = RecoveryState::new();
        state.heartbeat("main", true, 0, 1_000);
        state.heartbeat("hidden", false, 0, 1_000);
        *state.watchdog_last_tick_ms.lock().unwrap() = 20_999;
        assert_eq!(
            state.watchdog_actions(21_000),
            vec![WatchdogAction::Probe("main".into())]
        );
        assert!(state.watchdog_actions(23_999).is_empty());
        assert_eq!(
            state.watchdog_actions(24_000),
            vec![WatchdogAction::Rebuild("main".into())]
        );
    }

    #[test]
    fn watchdog_resets_grace_after_sleep() {
        let state = RecoveryState::new();
        state.heartbeat("main", true, 0, 1_000);
        *state.watchdog_last_tick_ms.lock().unwrap() = 2_000;
        assert!(state.watchdog_actions(30_000).is_empty());
        assert!(state.watchdog_actions(31_000).is_empty());
    }

    #[test]
    fn rebuilt_renderer_without_a_heartbeat_remains_monitored() {
        let state = RecoveryState::new();
        assert_eq!(
            state.begin_rebuild("main", true, 1_000),
            BeginRebuild::Started(1)
        );
        assert_eq!(state.finish_rebuild("main", true, 2_000), 1);
        *state.watchdog_last_tick_ms.lock().unwrap() = 21_999;
        assert_eq!(
            state.watchdog_actions(22_000),
            vec![WatchdogAction::Probe("main".into())]
        );
    }

    #[test]
    fn in_flight_rebuild_keeps_the_process_alive_until_finished() {
        let state = RecoveryState::new();
        assert!(!state.is_rebuilding());
        assert_eq!(
            state.begin_rebuild("main", false, 1_000),
            BeginRebuild::Started(1)
        );
        assert!(state.is_rebuilding());
        state.finish_rebuild("main", true, 2_000);
        assert!(!state.is_rebuilding());
    }

    #[test]
    fn manual_reload_closes_previews_before_reloading_renderer() {
        let steps = RefCell::new(Vec::new());
        reload_after_preview_cleanup::<()>(
            || steps.borrow_mut().push("close-previews"),
            || {
                steps.borrow_mut().push("reload-renderer");
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(
            steps.into_inner(),
            vec!["close-previews", "reload-renderer"]
        );
    }

    #[test]
    fn post_destroy_rebuild_failure_restarts_instead_of_staying_headless() {
        assert_eq!(rebuild_failure_action(false), RebuildFailureAction::Restart);
        assert_eq!(rebuild_failure_action(true), RebuildFailureAction::Prompt);
    }
}
