use tauri::window::Color;
use tauri::{App, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Menu model pushed from the frontend (src/lib/nativeMenu.ts). Fields are only
/// read inside the macOS-only builder, hence the dead_code guard keeping the
/// Windows CI build warning-free.
#[derive(serde::Deserialize)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct NativeMenuModel {
    pub menus: Vec<NativeMenu>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct NativeMenu {
    pub id: String,
    pub label: String,
    pub items: Vec<NativeMenuItem>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct NativeMenuItem {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    #[serde(default)]
    pub accelerator: Option<String>,
    pub kind: NativeItemKind,
    #[serde(default)]
    pub predefined: Option<String>,
    #[serde(default)]
    pub items: Option<Vec<NativeMenuItem>>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub enum NativeItemKind {
    Custom,
    Separator,
    Predefined,
}

/// Event emitted to the focused window when a native menu item is clicked.
/// Predefined items (copy/paste/undo/etc.) are handled by the system and never
/// reach `on_menu_event`, so only custom item ids are ever seen here.
#[cfg(target_os = "macos")]
pub const NATIVE_MENU_EVENT: &str = "native-menu-click";

/// Build the App submenu (About/Services/Hide/Quit): the one macOS requires to
/// exist for services / hide / quit to work at all. `set_menu` replaces the
/// entire menu bar, so every rebuild (fallback `init()` and `set_native_menu`)
/// must prepend this or TempoTerm/about/quit disappear from the menu bar.
#[cfg(target_os = "macos")]
fn build_app_submenu(handle: &tauri::AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, SubmenuBuilder};
    SubmenuBuilder::new(handle, &handle.package_info().name)
        .about(Some(AboutMetadata::default()))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()
}

/// Build the native macOS menu, reduced to the system minimum (App + Edit).
///
/// Every custom item that used to live here (New Window, Close Tab, Close
/// Window, Open Location, Cycle Pane, Setup Wizard) and its accelerator moved
/// into the frontend: the self-drawn `WindowMenuBar` (see
/// `src/components/menuBarMenus.ts`) now renders on both platforms, and
/// `App.tsx`'s webview keydown handler drives the platform-primary-modifier
/// shortcuts directly. Windows never had a native menu (the frame is hidden in
/// favor of the custom React title bar); macOS still needs *a* native menu
/// because the system requires one to exist for services / hide / quit, so a
/// minimal App menu is kept, plus an Edit menu so Cmd+C/V/X/A keep routing
/// through the system into whichever webview holds focus.
///
/// This is the fallback menu shown before the frontend pushes its own model
/// via `set_native_menu`; once it does, `rebuild_menu` replaces the Edit menu
/// with the frontend's menus (App submenu is always prepended, see
/// `build_app_submenu`).
pub fn init(app: &mut App) -> tauri::Result<()> {
    // Windows renders the in-window menu bar; no native menu at all.
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::{MenuBuilder, SubmenuBuilder};
        let handle = app.handle();

        let app_menu = build_app_submenu(handle)?;

        // Edit menu: keeps Cmd+C/V/X/A routed by the system into the webview.
        let edit_menu = SubmenuBuilder::new(handle, "Edit")
            .undo()
            .redo()
            .separator()
            .cut()
            .copy()
            .paste()
            .select_all()
            .build()?;

        let menu = MenuBuilder::new(handle)
            .items(&[&app_menu, &edit_menu])
            .build()?;
        app.set_menu(menu)?;

        // Dispatch custom item clicks to the focused window; predefined items
        // (copy/paste/undo/etc.) are handled by the system and never reach here.
        app.on_menu_event(|app, event| {
            use tauri::Emitter;
            if let Some(win) = app.get_focused_window() {
                let id = event.id().0.clone();
                let _ = win.emit_to(win.label(), NATIVE_MENU_EVENT, id);
            }
        });
    }
    Ok(())
}

/// One item built by [`build_items`]. Kept as an enum (rather than
/// `Box<dyn IsMenuItem>`) so submenus can still call type-specific methods if
/// ever needed; `as_menu_item` is the uniform view used to attach items to a
/// parent builder.
#[cfg(target_os = "macos")]
enum BuiltItem {
    Item(tauri::menu::MenuItem<tauri::Wry>),
    Predefined(tauri::menu::PredefinedMenuItem<tauri::Wry>),
    Sub(tauri::menu::Submenu<tauri::Wry>),
}

#[cfg(target_os = "macos")]
impl BuiltItem {
    fn as_menu_item(&self) -> &dyn tauri::menu::IsMenuItem<tauri::Wry> {
        match self {
            BuiltItem::Item(i) => i,
            BuiltItem::Predefined(i) => i,
            BuiltItem::Sub(i) => i,
        }
    }
}

/// Recursively build muda menu items from the frontend-provided defs.
/// Unknown predefined names are skipped rather than erroring, so a frontend
/// shipped ahead of this binary degrades gracefully instead of breaking the
/// whole menu rebuild.
#[cfg(target_os = "macos")]
fn build_items(app: &tauri::AppHandle, defs: &[NativeMenuItem]) -> tauri::Result<Vec<BuiltItem>> {
    use tauri::menu::{MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
    let mut out = Vec::new();
    for def in defs {
        match def.kind {
            NativeItemKind::Separator => {
                out.push(BuiltItem::Predefined(PredefinedMenuItem::separator(app)?));
            }
            NativeItemKind::Predefined => {
                // Empty label -> None keeps muda's default text (undo/redo/cut).
                let text = (!def.label.is_empty()).then_some(def.label.as_str());
                let item = match def.predefined.as_deref() {
                    Some("copy") => PredefinedMenuItem::copy(app, text)?,
                    Some("paste") => PredefinedMenuItem::paste(app, text)?,
                    Some("selectAll") => PredefinedMenuItem::select_all(app, text)?,
                    Some("cut") => PredefinedMenuItem::cut(app, text)?,
                    Some("undo") => PredefinedMenuItem::undo(app, text)?,
                    Some("redo") => PredefinedMenuItem::redo(app, text)?,
                    // Unknown predefined name from a newer frontend: skip, never crash.
                    _ => continue,
                };
                out.push(BuiltItem::Predefined(item));
            }
            NativeItemKind::Custom => {
                if let Some(children) = &def.items {
                    let built = build_items(app, children)?;
                    let mut sb = SubmenuBuilder::new(app, &def.label);
                    for child in &built {
                        sb = sb.item(child.as_menu_item());
                    }
                    out.push(BuiltItem::Sub(sb.build()?));
                } else {
                    let mut builder =
                        MenuItemBuilder::with_id(def.id.as_str(), &def.label).enabled(def.enabled);
                    if let Some(acc) = &def.accelerator {
                        builder = builder.accelerator(acc);
                    }
                    out.push(BuiltItem::Item(builder.build(app)?));
                }
            }
        }
    }
    Ok(out)
}

/// Replace the whole menu bar with the App submenu plus every menu from the
/// frontend model. `set_menu` swaps the bar wholesale, so the App submenu
/// (About/Services/Hide/Quit) is rebuilt and prepended on every call.
#[cfg(target_os = "macos")]
fn rebuild_menu(app: &tauri::AppHandle, model: &NativeMenuModel) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder};
    let mut mb = MenuBuilder::new(app).item(&build_app_submenu(app)?);
    for menu in &model.menus {
        let built = build_items(app, &menu.items)?;
        // Carry the frontend's menu id onto the muda Submenu id so the menu
        // stays addressable by id (and `NativeMenu::id` isn't dead code on
        // macOS, the only platform that ever reads this model).
        let mut sb = SubmenuBuilder::with_id(app, menu.id.as_str(), &menu.label);
        for child in &built {
            sb = sb.item(child.as_menu_item());
        }
        mb = mb.item(&sb.build()?);
    }
    app.set_menu(mb.build()?)?;
    Ok(())
}

/// Rebuild the native macOS menu bar from the model the frontend pushed
/// (`src/lib/nativeMenu.ts` invokes this on menu-tree changes).
/// No-op stub off macOS: the frontend hook only runs on macOS, but the command
/// must exist on every platform so `generate_handler!` stays cfg-free.
#[tauri::command]
pub fn set_native_menu(app: AppHandle, model: NativeMenuModel) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // set_menu dispatches to the main thread internally; wrapping this in an
        // extra run_on_main_thread nests that dispatch and the NSApp menu bar
        // never refreshes (verified on-device), so call it directly and let a
        // rebuild failure bubble to the frontend caller while the previous menu
        // stays in place.
        rebuild_menu(&app, &model).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, model);
        Ok(())
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_native_menu_model() {
        let json = r#"{
          "menus": [{
            "id": "view",
            "label": "檢視",
            "items": [
              { "id": "toggle-sidebar", "label": "切換側邊欄", "enabled": true,
                "accelerator": "Cmd+B", "kind": "custom" },
              { "id": "sep-1", "label": "", "enabled": false, "kind": "separator" },
              { "id": "copy", "label": "複製", "enabled": true,
                "kind": "predefined", "predefined": "copy" },
              { "id": "sidebar-panel", "label": "側邊欄面板", "enabled": true, "kind": "custom",
                "items": [
                  { "id": "sidebar-notes", "label": "筆記", "enabled": true,
                    "accelerator": "Alt+1", "kind": "custom" }
                ] }
            ]
          }]
        }"#;
        let model: NativeMenuModel = serde_json::from_str(json).expect("model deserializes");
        assert_eq!(model.menus.len(), 1);
        let menu = &model.menus[0];
        assert_eq!(menu.id, "view");
        assert_eq!(menu.items.len(), 4);
        assert!(matches!(menu.items[1].kind, NativeItemKind::Separator));
        assert_eq!(menu.items[2].predefined.as_deref(), Some("copy"));
        let sub = menu.items[3].items.as_ref().expect("submenu items");
        assert_eq!(sub[0].accelerator.as_deref(), Some("Alt+1"));
    }
}
