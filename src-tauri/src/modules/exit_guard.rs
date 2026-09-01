//! Cross-platform protection against quitting while terminal sessions are live.
//!
//! Window close requests are confirmed by the renderer so each window can be
//! handled independently. App-level exits (macOS Cmd+Q, an OS quit request, or
//! an explicit `AppHandle::exit`) bypass window events, so this module also
//! guards `RunEvent::ExitRequested` with a native dialog that remains usable
//! even when a WebView is unresponsive.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
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

    #[cfg(target_os = "macos")]
    pub(crate) fn language(&self) -> String {
        self.language.lock().unwrap().clone()
    }

    fn finish_prompt(&self) {
        self.prompting.store(false, Ordering::Release);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowCloseDecision {
    /// No live sessions belong to this window, so Tauri may close it normally.
    Allow,
    /// Ask before stopping the window's live sessions.
    Prompt,
    /// Stop the sessions and destroy the window without asking.
    CloseAndDestroy,
    /// A confirmation is already visible; suppress duplicate close requests.
    Ignore,
}

fn decide_window_close(
    enabled: bool,
    session_count: usize,
    busy_count: usize,
    prompting: bool,
) -> WindowCloseDecision {
    if session_count == 0 {
        WindowCloseDecision::Allow
    } else if !enabled || busy_count == 0 {
        // Idle shells still need their backend sessions cleaned up, but they
        // hold no work a prompt could save — close without asking, the way
        // Terminal.app and iTerm2 treat a bare prompt.
        WindowCloseDecision::CloseAndDestroy
    } else if prompting {
        WindowCloseDecision::Ignore
    } else {
        WindowCloseDecision::Prompt
    }
}

/// Sessions whose terminal is actually running a job (#366). SSH sessions all
/// count: a live remote shell's foreground state cannot be probed from here,
/// and over-asking beats silently dropping a remote connection.
fn all_busy_count(app: &AppHandle) -> usize {
    let pty = app.state::<PtyState>();
    let ssh = app.state::<SshState>();
    crate::modules::pty::busy_session_count(&pty) + crate::modules::ssh::session_count(&ssh)
}

fn window_busy_count(app: &AppHandle, owner: &str) -> usize {
    let pty = app.state::<PtyState>();
    let ssh = app.state::<SshState>();
    crate::modules::pty::busy_owned_session_count(&pty, owner)
        + crate::modules::ssh::owned_session_count(&ssh, owner)
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
    let count = all_busy_count(app);
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
        let confirmed = show_confirmation(&app, &language, count, true, None);
        let guard = app.state::<ExitGuardState>();
        guard.finish_prompt();
        if confirmed {
            guard.bypass_once.store(true, Ordering::Release);
            app.exit(0);
        }
    });
}

#[tauri::command]
pub fn exit_guard_configure(
    app: AppHandle,
    state: State<'_, ExitGuardState>,
    enabled: bool,
    language: String,
) -> Result<(), String> {
    state.enabled.store(enabled, Ordering::Release);
    *state.language.lock().unwrap() = language.clone();
    crate::modules::menu::refresh_language(&app, &language)
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
        let session_count = window_session_count(app, label);
        let busy_count = window_busy_count(app, label);
        let decision = decide_window_close(
            guard.enabled.load(Ordering::Acquire),
            session_count,
            busy_count,
            guard.prompting.load(Ordering::Acquire),
        );

        match decision {
            WindowCloseDecision::Allow => return,
            WindowCloseDecision::CloseAndDestroy => {
                // Confirmation is optional, cleanup is not. Prevent the native
                // close long enough to remove every owned backend session,
                // then explicitly destroy the window.
                api.prevent_close();
                close_window_sessions(app, label);
                if let Some(window) = app.get_webview_window(label) {
                    let _ = window.destroy();
                }
                return;
            }
            WindowCloseDecision::Ignore => {
                api.prevent_close();
                return;
            }
            WindowCloseDecision::Prompt => {}
        }

        // This is intentionally native and synchronous up to prevent_close():
        // React may be remounting, WebView2/WKWebView may be unresponsive, or
        // the renderer may already have terminated. The guard must still work
        // identically on macOS and Windows.
        api.prevent_close();
        // The pure decision used a snapshot. Claim the prompt atomically so two
        // close events racing between that snapshot and here still produce one
        // dialog at most.
        if guard
            .prompting
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }

        let app = app.clone();
        let label = label.clone();
        let language = guard.language.lock().unwrap().clone();
        std::thread::spawn(move || {
            let confirmed = show_confirmation(&app, &language, busy_count, false, Some(&label));
            let guard = app.state::<ExitGuardState>();
            guard.finish_prompt();
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
        || all_busy_count(app) == 0
    {
        return;
    }

    api.prevent_exit();
    if guard.prompting.swap(true, Ordering::AcqRel) {
        return;
    }

    let app = app.clone();
    let language = guard.language.lock().unwrap().clone();
    let count = all_busy_count(&app);
    std::thread::spawn(move || {
        let confirmed = show_confirmation(&app, &language, count, true, None);

        let guard = app.state::<ExitGuardState>();
        guard.finish_prompt();
        if confirmed {
            guard.bypass_once.store(true, Ordering::Release);
            app.exit(0);
        }
    });
}

fn show_confirmation(
    app: &AppHandle,
    language: &str,
    count: usize,
    quitting: bool,
    parent_label: Option<&str>,
) -> bool {
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
    let mut dialog = app
        .dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            confirm.to_string(),
            cancel.to_string(),
        ));
    let parent = parent_label
        .and_then(|label| app.get_webview_window(label))
        .or_else(|| {
            app.webview_windows()
                .into_values()
                .find(|window| window.is_focused().unwrap_or(false))
        });
    if let Some(parent) = parent {
        dialog = dialog.parent(&parent);
    }
    dialog.blocking_show()
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

    #[test]
    fn disabled_confirmation_still_closes_and_destroys_owned_sessions() {
        assert_eq!(
            decide_window_close(false, 1, 1, false),
            WindowCloseDecision::CloseAndDestroy
        );
    }

    #[test]
    fn close_without_owned_sessions_is_allowed() {
        assert_eq!(
            decide_window_close(true, 0, 0, false),
            WindowCloseDecision::Allow
        );
    }

    // #366: an idle prompt holds no work a prompt could save — clean up and
    // close without asking, exactly like a disabled guard, never like Allow
    // (the backend sessions still need closing).
    #[test]
    fn idle_sessions_close_without_a_prompt_but_with_cleanup() {
        assert_eq!(
            decide_window_close(true, 2, 0, false),
            WindowCloseDecision::CloseAndDestroy
        );
    }

    #[test]
    fn repeated_close_while_prompting_is_ignored() {
        assert_eq!(
            decide_window_close(true, 1, 1, false),
            WindowCloseDecision::Prompt
        );
        assert_eq!(
            decide_window_close(true, 1, 1, true),
            WindowCloseDecision::Ignore
        );
    }

    #[test]
    fn close_can_retry_after_prompt_finishes_even_if_destroy_failed() {
        let state = ExitGuardState::new();
        state.prompting.store(true, Ordering::Release);
        state.finish_prompt();

        assert_eq!(
            decide_window_close(true, 1, 1, state.prompting.load(Ordering::Acquire)),
            WindowCloseDecision::Prompt
        );
    }
}
