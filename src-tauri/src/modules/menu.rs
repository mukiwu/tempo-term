use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::window::Color;
use tauri::{App, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const NEW_WINDOW_ID: &str = "new-window";
const CLOSE_TAB_ID: &str = "close-tab";
const CLOSE_WINDOW_ID: &str = "close-window";
const OPEN_LOCATION_ID: &str = "preview-open-location";
/// Emitted to the focused window when ⌘/Ctrl+L is pressed, so the frontend can
/// focus the address bar of the active preview pane. A menu accelerator is used
/// because the native preview webview swallows key events before the app webview
/// can see them.
const OPEN_LOCATION_EVENT: &str = "menu:preview-open-location";
const CYCLE_PANE_ID: &str = "cycle-pane";
/// Emitted to the focused window when ⌘/Ctrl+` is pressed, so the frontend can
/// move focus to the next pane of the active tab. A menu accelerator is used for
/// the same reason as Open Location: a focused native preview webview would
/// otherwise swallow the key before the app webview's handler sees it.
const CYCLE_PANE_EVENT: &str = "menu:focus-next-pane";
const RERUN_SETUP_ID: &str = "rerun-setup";
/// Emitted to the focused window when the user picks "Setup Wizard" from the
/// File menu, so the frontend re-opens the first-run install guide on demand.
const RERUN_SETUP_EVENT: &str = "menu:rerun-setup";

/// Accelerator for a custom menu item, gated per platform.
///
/// On macOS these accelerators are what actually fire the shortcut — they work
/// even while a native preview webview holds keyboard focus (see the per-item
/// comments below). On Windows the native menu bar does not exist: the main
/// window runs with the native frame hidden (`set_decorations(false)` in
/// lib.rs, custom React title bar), so a menu accelerator never fires. There the
/// frontend handles the same shortcuts in its webview keydown handler instead
/// (see the `IS_WINDOWS` block in App.tsx). Returning `None` on Windows keeps the
/// menu items but strips their accelerators, so a shortcut can never fire twice.
#[cfg(not(target_os = "windows"))]
fn accel(shortcut: &str) -> Option<&str> {
    Some(shortcut)
}
#[cfg(target_os = "windows")]
fn accel(_shortcut: &str) -> Option<&str> {
    None
}

/// Build the menu (Tauri's default plus custom items and a Cmd+W rebind), set it
/// as the app menu, and wire the menu-event handler.
pub fn init(app: &mut App) -> tauri::Result<()> {
    // Owned handle so the menu-building borrows do not tangle with the later
    // app.set_menu / app.on_menu_event calls.
    let handle = app.handle().clone();
    let menu = Menu::default(&handle)?;
    let new_window = MenuItem::with_id(
        &handle,
        NEW_WINDOW_ID,
        "New Window",
        true,
        accel("CmdOrCtrl+N"),
    )?;
    // Cmd+W must peel the active tab, not destroy the window. Tauri's default
    // menu bundles a native "Close Window" (bound to the OS's standard Cmd+W) as
    // the LAST item of BOTH the File and Window submenus; either one closes the
    // real window at the runtime level before the frontend can react, and since
    // this app is usually a single window that quits the whole app. Both are
    // removed so Cmd+W is free for our custom "Close Tab"; closing the actual
    // window moves to Shift+Cmd+W.
    //
    // Removal matches by POSITION, not text or id: predefined items are
    // OS-localized (e.g. "Fermer la fenêtre") so a text match fails on non-English
    // systems, and their MenuId is a random per-instance counter (per muda's
    // source), so an id match fails too. The last-item position was confirmed
    // empirically for this tauri/muda version.
    //
    // Cmd+W / Cmd+` / Cmd+L are driven by menu accelerators (not webview keydown)
    // so they still fire when a native preview webview holds keyboard focus and
    // would otherwise swallow the key. Each emits an event to the focused window;
    // the frontend listens scoped to its own label.
    let close_tab =
        MenuItem::with_id(&handle, CLOSE_TAB_ID, "Close Tab", true, accel("CmdOrCtrl+W"))?;
    let close_window = MenuItem::with_id(
        &handle,
        CLOSE_WINDOW_ID,
        "Close Window",
        true,
        accel("Shift+CmdOrCtrl+W"),
    )?;
    let open_location = MenuItem::with_id(
        &handle,
        OPEN_LOCATION_ID,
        "Open Location",
        true,
        accel("CmdOrCtrl+L"),
    )?;
    let cycle_pane =
        MenuItem::with_id(&handle, CYCLE_PANE_ID, "Cycle Pane", true, accel("CmdOrCtrl+`"))?;
    let rerun_setup = MenuItem::with_id(&handle, RERUN_SETUP_ID, "Setup Wizard", true, None::<&str>)?;
    let mut inserted = false;
    for item in menu.items()? {
        let MenuItemKind::Submenu(submenu) = item else {
            continue;
        };
        let text = submenu.text()?;
        // Strip the trailing native "Close Window" from File and Window.
        if text == "File" || text == "Window" {
            let items = submenu.items()?;
            if matches!(items.last(), Some(MenuItemKind::Predefined(_))) {
                submenu.remove_at(items.len() - 1)?;
            }
        }
        match text.as_str() {
            "File" => {
                submenu.insert(&new_window, 0)?;
                submenu.insert(&PredefinedMenuItem::separator(&handle)?, 1)?;
                submenu.append(&open_location)?;
                submenu.append(&PredefinedMenuItem::separator(&handle)?)?;
                submenu.append(&rerun_setup)?;
                submenu.append(&PredefinedMenuItem::separator(&handle)?)?;
                submenu.append(&close_tab)?;
                inserted = true;
            }
            "Window" => {
                submenu.append(&cycle_pane)?;
                submenu.append(&close_window)?;
            }
            _ => {}
        }
    }
    debug_assert!(
        inserted,
        "menu default no longer has a File submenu to attach custom items to"
    );
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == NEW_WINDOW_ID {
            let _ = create_new_window(app);
        } else if event.id() == CLOSE_TAB_ID {
            // Target the focused window's label so only its frontend closes a
            // tab. The webview listens scoped to its own label; a bare emit()
            // would broadcast and close a tab in every open window.
            if let Some(win) = app.get_focused_window() {
                let _ = win.emit_to(win.label(), "menu:close-tab", ());
            }
        } else if event.id() == CLOSE_WINDOW_ID {
            if let Some(win) = app.get_focused_window() {
                let _ = win.close();
            }
        } else if event.id() == OPEN_LOCATION_ID {
            // Target the focused window's label so only its frontend focuses the
            // preview address bar; a bare emit() would broadcast to every window.
            if let Some(win) = app.get_focused_window() {
                let _ = win.emit_to(win.label(), OPEN_LOCATION_EVENT, ());
            }
        } else if event.id() == CYCLE_PANE_ID {
            // Target the focused window's label so only its frontend advances the
            // active pane; a bare emit() would cycle panes in every window.
            if let Some(win) = app.get_focused_window() {
                let _ = win.emit_to(win.label(), CYCLE_PANE_EVENT, ());
            }
        } else if event.id() == RERUN_SETUP_ID {
            // Target the focused window's label so only its frontend re-opens the
            // setup wizard; a bare emit() would open it in every window.
            if let Some(win) = app.get_focused_window() {
                let _ = win.emit_to(win.label(), RERUN_SETUP_EVENT, ());
            }
        }
    });
    Ok(())
}

/// Open a new window mirroring the main window's configuration. Each new window
/// loads the same frontend; the frontend gives it a fresh, isolated state.
pub fn create_new_window(app: &AppHandle) -> tauri::Result<()> {
    let label = next_window_label(app);
    // resizable(true) is required for data-tauri-drag-region to work on macOS
    // when a window is built dynamically (the overlay title bar's drag behaviour
    // depends on the window being resizable at creation time).
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title("TempoTerm")
        .inner_size(1200.0, 800.0)
        .min_inner_size(720.0, 480.0)
        .resizable(true)
        .background_color(Color(34, 34, 34, 255));
    // title_bar_style / hidden_title are macOS-only builder methods; on other
    // platforms the window keeps the default title bar. Mirrors the main window,
    // whose tauri.conf.json titleBarStyle/hiddenTitle are macOS-only too.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    // Windows hides the native frame in favour of the custom React title bar
    // (mirrors the main window's set_decorations(false) in lib.rs). Without this
    // a secondary window keeps the OS frame AND the native menu bar, while the
    // custom title bar renders underneath — two title bars at once. Setting it on
    // the builder means the native frame never flashes before being removed.
    #[cfg(target_os = "windows")]
    let builder = builder.decorations(false);
    let win = builder.build()?;
    // window-state plugin may restore a stale size from a previous run.
    // Clamp anything below the minimum back to the default so the window
    // cannot appear too small or off-screen — mirrors the main-window guard
    // in lib.rs setup().
    if let (Ok(size), Ok(scale)) = (win.inner_size(), win.scale_factor()) {
        let logical = size.to_logical::<f64>(scale);
        if logical.width < 720.0 || logical.height < 480.0 {
            win.set_size(tauri::LogicalSize::new(1200.0, 800.0))?;
            win.center()?;
        }
    }
    Ok(())
}

/// First `win-{n}` label not currently in use, so freed labels get reused and
/// the set stays small.
fn next_window_label(app: &AppHandle) -> String {
    let existing = app.webview_windows();
    let mut i = 1;
    loop {
        let label = format!("win-{i}");
        if !existing.contains_key(&label) {
            return label;
        }
        i += 1;
    }
}
