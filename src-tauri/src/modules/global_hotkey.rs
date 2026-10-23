//! The system-wide show/hide hotkey: from any app, brings TempoTerm to the
//! front, or hides it when one of its windows already has focus.

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Hide every window when one of them has focus, otherwise show them all and
/// focus the first.
fn toggle(app: &AppHandle) {
    let windows: Vec<_> = app.webview_windows().into_values().collect();
    let focused = windows.iter().any(|w| w.is_focused().unwrap_or(false));
    if focused {
        // macOS hides the app as a whole (like ⌘H), so it comes back with the
        // same window order; elsewhere each window hides on its own.
        #[cfg(target_os = "macos")]
        let _ = app.hide();
        #[cfg(not(target_os = "macos"))]
        for window in &windows {
            let _ = window.hide();
        }
        return;
    }
    #[cfg(target_os = "macos")]
    let _ = app.show();
    for window in &windows {
        let _ = window.unminimize();
        let _ = window.show();
    }
    if let Some(window) = windows.first() {
        let _ = window.set_focus();
    }
}

/// Replace the hotkey with `accelerator` (for example `Cmd+Shift+Space`), or
/// remove it when `None`. Every window calls this with the same setting, so
/// the last call simply re-registers the same key. This is the only global
/// shortcut the app registers, so clearing them all clears just this one.
#[tauri::command]
pub fn global_hotkey_set(app: AppHandle, accelerator: Option<String>) -> Result<(), String> {
    // Parse before unregistering, so a bad value leaves the current key alone.
    let shortcut: Option<Shortcut> = accelerator
        .filter(|a| !a.trim().is_empty())
        .map(|a| a.parse().map_err(|e| format!("invalid shortcut {a}: {e}")))
        .transpose()?;
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(|e| e.to_string())?;
    let Some(shortcut) = shortcut else {
        return Ok(());
    };
    shortcuts
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle(app);
            }
        })
        .map_err(|e| e.to_string())
}
