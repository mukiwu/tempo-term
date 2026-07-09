// Native preview webview lifecycle, owned by Rust so we can attach builder-only
// callbacks the JS `Webview` API lacks: `on_document_title_changed` (drives the
// tab title from the real page `<title>`) and `on_navigation` (keeps the address
// bar in sync with in-page link clicks). Positioning/show/hide stays on the JS
// side (via `Webview.getByLabel`); only creation and history control live here.

use serde::Serialize;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, WebviewUrl, Window};

/// Prefix every preview webview label carries (see `previewWebviewLabel` in
/// previewWebview.ts). Commands refuse any label without it, so they can never
/// target the app's own window.
const LABEL_PREFIX: &str = "preview-";

/// Emitted whenever a preview page's title changes. The frontend filters by
/// `label` and retitles the owning tab.
const TITLE_EVENT: &str = "preview://title";
/// Emitted on every top-level navigation (link click, redirect, or address-bar
/// load). The frontend filters by `label` and follows the url in the address bar.
const NAVIGATED_EVENT: &str = "preview://navigated";

// Injected into every previewed page so ⌘/Ctrl + [ and ] drive the page's own
// history even while the native webview — not the app — holds keyboard focus.
// Uses capture so it beats a page's own key handlers.
const HISTORY_KEY_SCRIPT: &str = r#"
(function () {
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      if (e.key === '[') { e.preventDefault(); window.history.back(); }
      else if (e.key === ']') { e.preventDefault(); window.history.forward(); }
    }
  }, true);
})();
"#;

#[derive(Clone, Serialize)]
struct TitlePayload {
    label: String,
    title: String,
}

#[derive(Clone, Serialize)]
struct NavigatedPayload {
    label: String,
    url: String,
}

/// Create the native child webview for a preview pane inside the calling window.
/// The rect is in unzoomed window (logical) pixels; the JS side keeps it aligned
/// to the pane afterwards.
///
/// `async` on purpose: a sync command runs on the macOS main thread, where
/// `add_child` blocks it on WKWebView init (50–200 ms first time) and freezes the
/// UI. An async command runs on a worker, so `add_child` waits off the main
/// thread and the event loop stays responsive.
#[tauri::command]
pub async fn preview_create(
    window: Window,
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // The frontend supplies `label` and `url`; validate both so a compromised
    // webview can't drive an arbitrary window (e.g. navigate/close "main") or
    // load a privileged scheme (`file://` bypasses the assetProtocol deny-list).
    ensure_preview_label(&label)?;
    let parsed = parse_preview_url(&url)?;

    // Idempotent: if a preview webview with this label already exists (e.g. a
    // racing re-mount got here first), just point it at the url instead of
    // failing to build a duplicate. The label guard above ensures we only ever
    // touch a preview webview here, never the app's own window.
    if let Some(existing) = app.get_webview(&label) {
        return existing.navigate(parsed).map_err(|e| e.to_string());
    }

    // Scope the title/navigation events to the owning window so a secondary
    // window never receives another window's browsing titles/urls.
    let win_label = window.label().to_string();
    let title_label = label.clone();
    let title_app = app.clone();
    let title_win = win_label.clone();
    let nav_label = label.clone();
    let nav_app = app.clone();
    let nav_win = win_label;

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .initialization_script(HISTORY_KEY_SCRIPT)
        .on_document_title_changed(move |_webview, title| {
            let _ = title_app.emit_to(
                &title_win,
                TITLE_EVENT,
                TitlePayload {
                    label: title_label.clone(),
                    title,
                },
            );
        })
        .on_navigation(move |url| {
            let _ = nav_app.emit_to(
                &nav_win,
                NAVIGATED_EVENT,
                NavigatedPayload {
                    label: nav_label.clone(),
                    url: url.to_string(),
                },
            );
            // Always allow the navigation; we only observe it.
            true
        });

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| format!("failed to create preview webview {label}: {e}"))?;
    Ok(())
}

/// Atomically move and resize the preview webview in ONE call. The rect is in
/// unzoomed window (logical) pixels, same convention as `preview_create`.
///
/// This exists because the JS `setPosition` + `setSize` pair is not safe on
/// Windows: in tauri's runtime each of the two messages does a read-modify-write
/// of the full bounds (read current bounds, replace one half, write both back),
/// and the write lands asynchronously (`SWP_ASYNCWINDOWPOS`). The second message
/// can therefore read back a rect the first write has not applied yet and
/// re-commit that stale half — in practice the webview kept its creation-time
/// size while the position landed, leaving an L-shaped gap in the pane (#163).
/// A single `set_bounds` carries both halves in one message, so nothing is ever
/// read back or re-committed.
#[tauri::command]
pub fn preview_set_bounds(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    webview(&app, &label)?
        .set_bounds(Rect {
            position: LogicalPosition::new(x, y).into(),
            size: LogicalSize::new(width, height).into(),
        })
        .map_err(|e| e.to_string())
}

/// Navigate the existing preview webview to a new url without recreating it, so
/// its back/forward history survives.
#[tauri::command]
pub fn preview_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let parsed = parse_preview_url(&url)?;
    webview(&app, &label)?
        .navigate(parsed)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preview_reload(app: AppHandle, label: String) -> Result<(), String> {
    webview(&app, &label)?.reload().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preview_history_back(app: AppHandle, label: String) -> Result<(), String> {
    eval_history(&app, &label, "back")
}

#[tauri::command]
pub fn preview_history_forward(app: AppHandle, label: String) -> Result<(), String> {
    eval_history(&app, &label, "forward")
}

/// Close and drop the preview webview. Safe to call when it is already gone.
#[tauri::command]
pub fn preview_close(app: AppHandle, label: String) -> Result<(), String> {
    ensure_preview_label(&label)?;
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn eval_history(app: &AppHandle, label: &str, direction: &str) -> Result<(), String> {
    webview(app, label)?
        .eval(format!("window.history.{direction}()"))
        .map_err(|e| e.to_string())
}

/// Resolve a preview webview by label, refusing any label that isn't namespaced
/// as a preview so these commands can never target the app's own window.
fn webview(app: &AppHandle, label: &str) -> Result<tauri::Webview, String> {
    ensure_preview_label(label)?;
    app.get_webview(label)
        .ok_or_else(|| format!("preview webview {label} not found"))
}

/// Reject any label the frontend didn't namespace with the preview prefix (see
/// `previewWebviewLabel` in previewWebview.ts) — the trust boundary that keeps a
/// compromised frontend from driving or closing the main app window.
fn ensure_preview_label(label: &str) -> Result<(), String> {
    if label.starts_with(LABEL_PREFIX) {
        Ok(())
    } else {
        Err(format!("refusing to operate on non-preview webview {label}"))
    }
}

/// Accept only the schemes previews actually use. Notably rejects `file://`,
/// which WKWebView would load natively and thereby bypass the `asset://`
/// secrets deny-list in tauri.conf.json.
fn parse_preview_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|e| format!("invalid preview url {url}: {e}"))?;
    match parsed.scheme() {
        "http" | "https" | "asset" => Ok(parsed),
        other => Err(format!("refusing to load unsupported scheme '{other}' in preview")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_guard_accepts_only_preview_labels() {
        assert!(ensure_preview_label("preview-main-leaf1").is_ok());
        assert!(ensure_preview_label("main").is_err());
        assert!(ensure_preview_label("").is_err());
    }

    #[test]
    fn preview_urls_reject_privileged_schemes() {
        assert!(parse_preview_url("https://example.com").is_ok());
        assert!(parse_preview_url("http://localhost:3000").is_ok());
        assert!(parse_preview_url("asset://localhost/x").is_ok());
        assert!(parse_preview_url("file:///etc/passwd").is_err());
        assert!(parse_preview_url("javascript:alert(1)").is_err());
    }
}
