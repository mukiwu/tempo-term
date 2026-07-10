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
pub fn init(app: &mut App) -> tauri::Result<()> {
    // Windows renders the in-window menu bar; no native menu at all.
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};
        let handle = app.handle();

        // App menu: macOS requires it; keep only system-provided items.
        let app_menu = SubmenuBuilder::new(handle, "TempoTerm")
            .about(Some(AboutMetadata::default()))
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;

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
    }
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
