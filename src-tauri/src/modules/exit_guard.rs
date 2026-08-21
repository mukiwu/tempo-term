//! Cross-platform protection against quitting while terminal sessions are live.
//!
//! Window close requests are confirmed by the renderer so each window can be
//! handled independently. App-level exits (macOS Cmd+Q, an OS quit request, or
//! an explicit `AppHandle::exit`) bypass window events, so this module also
//! guards `RunEvent::ExitRequested` with a native dialog that remains usable
//! even when a WebView is unresponsive.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, RunEvent, State, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::modules::pty::PtyState;
use crate::modules::ssh::SshState;

pub struct ExitGuardState {
    enabled: AtomicBool,
    prompting: AtomicBool,
    bypass_once: AtomicBool,
    language: Mutex<String>,
}

impl ExitGuardState {
    pub fn new() -> Self {
        Self {
            // Opt-out: old installations that have not persisted this setting
            // are protected immediately, even before the frontend is loaded.
            enabled: AtomicBool::new(true),
            prompting: AtomicBool::new(false),
            bypass_once: AtomicBool::new(false),
            language: Mutex::new("en".to_string()),
        }
    }
}

fn all_session_count(app: &AppHandle) -> usize {
    let pty = app.state::<PtyState>();
    let ssh = app.state::<SshState>();
    crate::modules::pty::session_count(&pty) + crate::modules::ssh::session_count(&ssh)
}

fn window_session_count(app: &AppHandle, owner: &str) -> usize {
    let pty = app.state::<PtyState>();
    let ssh = app.state::<SshState>();
    crate::modules::pty::owned_session_count(&pty, owner)
        + crate::modules::ssh::owned_session_count(&ssh, owner)
}

fn close_window_sessions(app: &AppHandle, owner: &str) {
    let pty = app.state::<PtyState>();
    let ssh = app.state::<SshState>();
    crate::modules::pty::close_owned_sessions(&pty, owner);
    crate::modules::ssh::close_owned_sessions(&ssh, owner);
}

/// macOS's custom Cmd+Q menu item enters here instead of using AppKit's
/// predefined `terminate:` selector, which cannot be cancelled by Tauri.
#[cfg(target_os = "macos")]
pub fn request_quit(app: &AppHandle) {
    let guard = app.state::<ExitGuardState>();
    let count = all_session_count(app);
    if !guard.enabled.load(Ordering::Acquire) || count == 0 {
        guard.bypass_once.store(true, Ordering::Release);
        app.exit(0);
        return;
    }
    if guard.prompting.swap(true, Ordering::AcqRel) {
        return;
    }

    let app = app.clone();
    let language = guard.language.lock().unwrap().clone();
    std::thread::spawn(move || {
        let confirmed = show_confirmation(&app, &language, count, true);
        let guard = app.state::<ExitGuardState>();
        guard.prompting.store(false, Ordering::Release);
        if confirmed {
            guard.bypass_once.store(true, Ordering::Release);
            app.exit(0);
        }
    });
}

#[tauri::command]
pub fn exit_guard_configure(state: State<'_, ExitGuardState>, enabled: bool, language: String) {
    state.enabled.store(enabled, Ordering::Release);
    *state.language.lock().unwrap() = language;
}

#[tauri::command]
pub fn terminal_window_session_count(
    window: WebviewWindow,
    pty: State<'_, PtyState>,
    ssh: State<'_, SshState>,
) -> usize {
    crate::modules::pty::owned_session_count(&pty, window.label())
        + crate::modules::ssh::owned_session_count(&ssh, window.label())
}

#[tauri::command]
pub fn terminal_close_window_sessions(
    window: WebviewWindow,
    pty: State<'_, PtyState>,
    ssh: State<'_, SshState>,
) {
    crate::modules::pty::close_owned_sessions(&pty, window.label());
    crate::modules::ssh::close_owned_sessions(&ssh, window.label());
}

/// Protect exits that do not pass through a window's CloseRequested event.
pub fn handle_run_event(app: &AppHandle, event: &RunEvent) {
    if let RunEvent::WindowEvent {
        label,
        event: WindowEvent::CloseRequested { api, .. },
        ..
    } = event
    {
        let guard = app.state::<ExitGuardState>();
        if !guard.enabled.load(Ordering::Acquire) || window_session_count(app, label) == 0 {
            return;
        }

        // This is intentionally native and synchronous up to prevent_close():
        // React may be remounting, WebView2/WKWebView may be unresponsive, or
        // the renderer may already have terminated. The guard must still work
        // identically on macOS and Windows.
        api.prevent_close();
        if guard.prompting.swap(true, Ordering::AcqRel) {
            return;
        }

        let app = app.clone();
        let label = label.clone();
        let language = guard.language.lock().unwrap().clone();
        let count = window_session_count(&app, &label);
        std::thread::spawn(move || {
            let confirmed = show_confirmation(&app, &language, count, false);
            let guard = app.state::<ExitGuardState>();
            guard.prompting.store(false, Ordering::Release);
            if confirmed {
                close_window_sessions(&app, &label);
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.destroy();
                }
            }
        });
        return;
    }

    let RunEvent::ExitRequested { api, .. } = event else {
        return;
    };
    let guard = app.state::<ExitGuardState>();
    if guard.bypass_once.swap(false, Ordering::AcqRel)
        || !guard.enabled.load(Ordering::Acquire)
        || all_session_count(app) == 0
    {
        return;
    }

    api.prevent_exit();
    if guard.prompting.swap(true, Ordering::AcqRel) {
        return;
    }

    let app = app.clone();
    let language = guard.language.lock().unwrap().clone();
    let count = all_session_count(&app);
    std::thread::spawn(move || {
        let confirmed = show_confirmation(&app, &language, count, true);

        let guard = app.state::<ExitGuardState>();
        guard.prompting.store(false, Ordering::Release);
        if confirmed {
            guard.bypass_once.store(true, Ordering::Release);
            app.exit(0);
        }
    });
}

fn show_confirmation(app: &AppHandle, language: &str, count: usize, quitting: bool) -> bool {
    let zh_hant = language.starts_with("zh");
    let (title, message, confirm, cancel) = if zh_hant {
        let action = if quitting {
            "結束 TempoTerm"
        } else {
            "關閉視窗"
        };
        (
            "仍有終端機正在執行",
            format!(
                "目前仍有 {count} 個終端或 SSH 工作階段。{action}會中止這些工作階段，確定要繼續嗎？"
            ),
            if quitting {
                "仍要結束"
            } else {
                "仍要關閉"
            },
            "取消",
        )
    } else {
        let action = if quitting {
            "Quitting TempoTerm"
        } else {
            "Closing this window"
        };
        (
            "Terminal sessions are still running",
            format!(
                "{count} terminal or SSH session(s) are still running. {action} will stop them. Do you want to continue?"
            ),
            if quitting { "Quit Anyway" } else { "Close Anyway" },
            "Cancel",
        )
    };
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            confirm.to_string(),
            cancel.to_string(),
        ))
        .blocking_show()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_confirmation_defaults_to_enabled() {
        let state = ExitGuardState::new();
        assert!(state.enabled.load(Ordering::Acquire));
        assert!(!state.prompting.load(Ordering::Acquire));
    }
}
