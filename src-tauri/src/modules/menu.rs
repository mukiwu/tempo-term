use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::window::Color;
use tauri::{App, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const NEW_WINDOW_ID: &str = "new-window";
const CLOSE_WINDOW_ID: &str = "close-window";

/// Build the menu (Tauri's default plus a New Window item injected into File),
/// set it as the app menu, and wire the menu-event handler.
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
        Some("CmdOrCtrl+N"),
    )?;
    // Tauri's default menu bundles TWO separate native "Close Window" items
    // bound to Cmd+W (the OS's standard accelerator) — the last item in
    // "File" (its only item) and the last item in "Window" (after
    // Minimize/Maximize/separator). Either one closes the actual window
    // directly at the Tauri-runtime level, bypassing the frontend's own
    // close-pane-or-tab keydown handler (src/App.tsx's `key === "w"`
    // branch) entirely — and since this app is usually a single window,
    // closing it quits the whole app. Both must be removed (removing only
    // one still leaves Cmd+W captured by the other) so Cmd+W reaches the
    // frontend handler. Closing the actual window moves to Shift+Cmd+W
    // instead, wired below as a custom item since
    // PredefinedMenuItem::close_window has no accelerator override.
    //
    // Removal matches by POSITION, not by the item's text — predefined
    // items are localized by the OS (e.g. "Fermer la fenêtre" in French),
    // so a text match would silently fail on non-English systems, and their
    // `MenuId` is a random per-instance counter (confirmed by reading
    // muda's source), not a stable value tied to which predefined action
    // they represent, so an id match doesn't work either. The exact
    // position was confirmed empirically for this tauri/muda version via a
    // temporary runtime diagnostic dump of the actual default menu
    // structure, not just from documentation.
    let close_window = MenuItem::with_id(
        &handle,
        CLOSE_WINDOW_ID,
        "Close Window",
        true,
        Some("Shift+CmdOrCtrl+W"),
    )?;
    let mut inserted_close_window = false;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            let text = submenu.text()?;
            if text == "File" || text == "Window" {
                let items = submenu.items()?;
                if matches!(items.last(), Some(MenuItemKind::Predefined(_))) {
                    submenu.remove_at(items.len() - 1)?;
                }
            }
            if text == "File" {
                submenu.insert(&new_window, 0)?;
                submenu.insert(&PredefinedMenuItem::separator(&handle)?, 1)?;
                submenu.append(&close_window)?;
                inserted_close_window = true;
            }
        }
    }
    debug_assert!(
        inserted_close_window,
        "menu default no longer has a File submenu to attach Close Window to"
    );
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == NEW_WINDOW_ID {
            let _ = create_new_window(app);
        } else if event.id() == CLOSE_WINDOW_ID {
            if let Some(window) = app.get_focused_window() {
                let _ = window.close();
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
