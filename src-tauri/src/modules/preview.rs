// Native preview webview lifecycle, owned by Rust so we can attach builder-only
// callbacks the JS `Webview` API lacks: `on_document_title_changed` (drives the
// tab title from the real page `<title>`) and `on_navigation` (keeps the address
// bar in sync with in-page link clicks). Positioning/show/hide stays on the JS
// side (via `Webview.getByLabel`); only creation and history control live here.

use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
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

// Injected into every previewed page so the app's keyboard shortcuts survive
// even while the native webview — not the app — holds OS keyboard focus.
// Uses capture so it beats a page's own key handlers.
//
// [ and ] drive the page's own history directly (`window.history`), no bridge
// needed. W, L and ` need the *app* to react (close a tab, focus the address
// bar, cycle panes), and this webview has no Tauri IPC capability at all (see
// `preview_forward_key_action` below for why) — so instead of `invoke`, they
// navigate to a fake, never-loaded `KEY_ACTION_SCHEME` URL that `on_navigation`
// below recognizes, dispatches, and always cancels. This is the same
// "intercept a scheme, cancel the navigation" trick apps have long used to
// bridge custom URL schemes (e.g. `mailto:`) out of a webview, just repurposed
// as a one-way signal instead of a real link.
//
// A previewed page's OWN script can also fire `window.location.href =
// 'tempo-preview-key:close-tab'` directly — the scheme is not a secret, it's
// visible right here. Without a check, that would let any page (or a
// compromised/malicious one loaded in the preview) close tabs or windows in
// the host app. `TOKEN` closes that hole: it's minted fresh per preview
// webview (see `generate_preview_token`) and baked into this script's IIFE
// scope by `preview_create` before the page's own scripts ever run. A page
// script can trigger navigations, but it cannot read a variable local to this
// closure, so it cannot forge a value `decide_navigation` will accept.
const KEY_FORWARD_SCRIPT: &str = r#"
(function () {
  var TOKEN = "__TEMPO_PREVIEW_TOKEN__";
  function forward(action) {
    window.location.href = 'tempo-preview-key:' + action + '?t=' + TOKEN;
  }
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      if (e.key === '[') { e.preventDefault(); window.history.back(); return; }
      if (e.key === ']') { e.preventDefault(); window.history.forward(); return; }
      if (e.code === 'KeyW') {
        e.preventDefault();
        e.stopPropagation();
        forward(e.shiftKey ? 'close-window' : 'close-tab');
        return;
      }
      if (e.code === 'KeyL' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        forward('open-location');
        return;
      }
      if (e.code === 'Backquote' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        forward('cycle-pane');
        return;
      }
    }
  }, true);
})();
"#;

/// Scheme used by `KEY_FORWARD_SCRIPT` to signal a whitelisted app-level key
/// action back to Rust. Never a real navigation target — `on_navigation`
/// recognizes it, dispatches the action, and always cancels the navigation so
/// the webview never actually attempts to load it.
const KEY_ACTION_SCHEME: &str = "tempo-preview-key";

/// The fixed whitelist of UI actions the preview webview may trigger. Nothing
/// outside this set can be forwarded — see `preview_key_action_from_str`.
#[cfg_attr(test, derive(Debug, PartialEq, Eq))]
enum PreviewKeyAction {
    CloseTab,
    CloseWindow,
    OpenLocation,
    CyclePane,
}

/// Parse a raw action string against the whitelist. Anything else — typos,
/// unrelated strings, an attacker trying to widen the surface — is `None` and
/// silently ignored by the caller.
fn preview_key_action_from_str(action: &str) -> Option<PreviewKeyAction> {
    match action {
        "close-tab" => Some(PreviewKeyAction::CloseTab),
        "close-window" => Some(PreviewKeyAction::CloseWindow),
        "open-location" => Some(PreviewKeyAction::OpenLocation),
        "cycle-pane" => Some(PreviewKeyAction::CyclePane),
        _ => None,
    }
}

/// What `on_navigation` should do with a navigation attempt, decided once by
/// `decide_navigation` so the closure has nothing left to get wrong.
#[cfg_attr(test, derive(Debug, PartialEq, Eq))]
enum NavDecision {
    /// Our scheme, whitelisted action: dispatch it, cancel the navigation.
    ForwardAction(PreviewKeyAction),
    /// Our scheme, but not a whitelisted action — typo, case mismatch,
    /// authority-form url (`scheme://action`), or a stray query/fragment
    /// tacked on. Swallowed with no event and no load attempt: the whitelist
    /// is the only way in, everything else is refused, never passed through
    /// to a real navigation.
    CancelSilently,
    /// Any other scheme: a real page navigation, only observed.
    Observe,
}

/// Decide what `on_navigation` should do with a navigation attempt. Scheme is
/// checked first: anything other than `KEY_ACTION_SCHEME` is a real
/// navigation and always observed, regardless of its path. Under our own
/// scheme, forwarding requires ALL of: no authority/fragment, an exact
/// whitelisted action, and a query string that is exactly `t=<expected_token>`
/// (nothing else, no extra parameters). Every other shape under that scheme —
/// including a bare action with no token at all, the pre-nonce form a stale
/// or forged navigation would use — is cancelled silently rather than falling
/// through to a real load. `expected_token` is the per-preview-webview token
/// `preview_create` minted and baked into `KEY_FORWARD_SCRIPT`'s closure, so
/// only that script (never a page's own script) can produce a match.
fn decide_navigation(url: &Url, expected_token: &str) -> NavDecision {
    if url.scheme() != KEY_ACTION_SCHEME {
        return NavDecision::Observe;
    }
    if url.host().is_some() || url.fragment().is_some() {
        return NavDecision::CancelSilently;
    }
    let Some(action) = preview_key_action_from_str(url.path()) else {
        return NavDecision::CancelSilently;
    };
    let mut pairs = url.query_pairs();
    let token_matches = matches!(
        (pairs.next(), pairs.next()),
        (Some((key, value)), None) if key == "t" && value == expected_token
    );
    if token_matches {
        NavDecision::ForwardAction(action)
    } else {
        NavDecision::CancelSilently
    }
}

/// A counter mixed into every generated token so two previews created within
/// the same process tick never collide.
static PREVIEW_TOKEN_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Mint a per-preview-webview token to gate `tempo-preview-key:` navigations
/// (see `KEY_FORWARD_SCRIPT` and `decide_navigation`). This only has to resist
/// a previewed page's own script guessing it — that script cannot read this
/// process's clock, pid, or counter state, let alone the Rust closure the
/// token is compared against — so no crate dependency is pulled in purely for
/// this; the wall-clock time, process id and a monotonic counter are hashed
/// together with the standard library's `DefaultHasher`. Not a cryptographic
/// secret, and not meant to be one.
fn generate_preview_token() -> String {
    let mut hasher = DefaultHasher::new();
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .hash(&mut hasher);
    std::process::id().hash(&mut hasher);
    PREVIEW_TOKEN_COUNTER
        .fetch_add(1, Ordering::Relaxed)
        .hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// Forward a whitelisted key action to the window that owns this preview
/// webview — the window `preview_create` was called from, captured at
/// creation time in the `on_navigation` closure below. This mirrors the old
/// native `on_menu_event`'s `get_focused_window()` targeting, except the
/// target here is the preview's owning window, not whichever window currently
/// has OS focus: the preview holding keyboard focus already tells us which
/// window the user means, so there is no ambiguity to resolve, and no need to
/// broadcast to every window.
fn forward_preview_key_action(app: &AppHandle, window_label: &str, action: PreviewKeyAction) {
    match action {
        PreviewKeyAction::CloseTab => {
            let _ = app.emit_to(window_label, "menu:close-tab", ());
        }
        PreviewKeyAction::OpenLocation => {
            let _ = app.emit_to(window_label, "menu:preview-open-location", ());
        }
        PreviewKeyAction::CyclePane => {
            let _ = app.emit_to(window_label, "menu:focus-next-pane", ());
        }
        PreviewKeyAction::CloseWindow => {
            if let Some(window) = app.get_window(window_label) {
                let _ = window.close();
            }
        }
    }
}

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

    // Mint this preview's token and bake it into its own copy of the
    // key-forward script (see the doc comments on `KEY_FORWARD_SCRIPT` and
    // `decide_navigation`). Each preview webview gets a distinct token.
    let nav_token = generate_preview_token();
    let init_script = KEY_FORWARD_SCRIPT.replace("__TEMPO_PREVIEW_TOKEN__", &nav_token);

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .initialization_script(init_script)
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
        .on_navigation(move |url| match decide_navigation(url, &nav_token) {
            // KEY_FORWARD_SCRIPT's W/L/` handling signals through a fake
            // navigation rather than a real one (this webview has no IPC
            // capability to `invoke` with — see the doc comment on
            // KEY_FORWARD_SCRIPT). Dispatch the action and cancel it so it
            // never actually attempts to load.
            NavDecision::ForwardAction(action) => {
                forward_preview_key_action(&nav_app, &nav_win, action);
                false
            }
            // Our scheme, but not a whitelisted action. Swallow it silently
            // (no event, no load) instead of letting it fall through to a
            // real navigation attempt with a nonsense url.
            NavDecision::CancelSilently => false,
            // A real page navigation: observe it so the address bar stays in
            // sync, and allow it.
            NavDecision::Observe => {
                let _ = nav_app.emit_to(
                    &nav_win,
                    NAVIGATED_EVENT,
                    NavigatedPayload {
                        label: nav_label.clone(),
                        url: url.to_string(),
                    },
                );
                true
            }
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

    #[test]
    fn key_action_whitelist_accepts_only_known_actions() {
        assert_eq!(
            preview_key_action_from_str("close-tab"),
            Some(PreviewKeyAction::CloseTab)
        );
        assert_eq!(
            preview_key_action_from_str("close-window"),
            Some(PreviewKeyAction::CloseWindow)
        );
        assert_eq!(
            preview_key_action_from_str("open-location"),
            Some(PreviewKeyAction::OpenLocation)
        );
        assert_eq!(
            preview_key_action_from_str("cycle-pane"),
            Some(PreviewKeyAction::CyclePane)
        );
        // Unknown/garbage/attacker-supplied strings are ignored, not errored.
        assert_eq!(preview_key_action_from_str("close-taboo"), None);
        assert_eq!(preview_key_action_from_str(""), None);
        assert_eq!(preview_key_action_from_str("preview_navigate"), None);
    }

    const TEST_TOKEN: &str = "secret-token-123";

    #[test]
    fn decide_navigation_forwards_whitelisted_actions_with_the_correct_token() {
        let url = Url::parse("tempo-preview-key:close-tab?t=secret-token-123").unwrap();
        assert_eq!(
            decide_navigation(&url, TEST_TOKEN),
            NavDecision::ForwardAction(PreviewKeyAction::CloseTab)
        );
    }

    #[test]
    fn decide_navigation_cancels_silently_when_the_token_is_missing_or_wrong() {
        // No query at all (the pre-nonce shape a forged/stale navigation
        // would use, and what a page's own script could still fire even
        // without ever seeing the real token).
        let no_token = Url::parse("tempo-preview-key:close-tab").unwrap();
        assert_eq!(decide_navigation(&no_token, TEST_TOKEN), NavDecision::CancelSilently);

        // Right shape, wrong value — a guess never matches the minted token.
        let wrong_token = Url::parse("tempo-preview-key:close-tab?t=guess").unwrap();
        assert_eq!(
            decide_navigation(&wrong_token, TEST_TOKEN),
            NavDecision::CancelSilently
        );

        // Right token value under the wrong query key doesn't count.
        let wrong_key = Url::parse("tempo-preview-key:close-tab?token=secret-token-123").unwrap();
        assert_eq!(
            decide_navigation(&wrong_key, TEST_TOKEN),
            NavDecision::CancelSilently
        );

        // A correct token riding along with an extra parameter is rejected
        // outright rather than accepted with the extra data ignored.
        let extra_param =
            Url::parse("tempo-preview-key:close-tab?t=secret-token-123&x=1").unwrap();
        assert_eq!(
            decide_navigation(&extra_param, TEST_TOKEN),
            NavDecision::CancelSilently
        );

        // A correct token with a fragment tacked on is rejected too.
        let with_fragment =
            Url::parse("tempo-preview-key:close-tab?t=secret-token-123#frag").unwrap();
        assert_eq!(
            decide_navigation(&with_fragment, TEST_TOKEN),
            NavDecision::CancelSilently
        );
    }

    #[test]
    fn decide_navigation_cancels_silently_for_unrecognized_same_scheme_urls() {
        // Unknown action name, even with the correct token.
        let garbage = Url::parse("tempo-preview-key:garbage?t=secret-token-123").unwrap();
        assert_eq!(decide_navigation(&garbage, TEST_TOKEN), NavDecision::CancelSilently);

        // Whitelist match is case-sensitive; a differently-cased action is
        // not a known action.
        let wrong_case = Url::parse("tempo-preview-key:Close-Tab?t=secret-token-123").unwrap();
        assert_eq!(
            decide_navigation(&wrong_case, TEST_TOKEN),
            NavDecision::CancelSilently
        );

        // Authority form (`scheme://host`) puts "close-tab" in the host, not
        // the path — never mistaken for the real whitelisted action, token or
        // not.
        let authority_form =
            Url::parse("tempo-preview-key://close-tab?t=secret-token-123").unwrap();
        assert_eq!(
            decide_navigation(&authority_form, TEST_TOKEN),
            NavDecision::CancelSilently
        );
    }

    #[test]
    fn decide_navigation_observes_real_navigations() {
        // A real preview navigation (any http(s)/asset url) is always
        // observed, even if the page path happens to match a whitelisted
        // action name.
        let real_nav = Url::parse("https://example.com/close-tab").unwrap();
        assert_eq!(decide_navigation(&real_nav, TEST_TOKEN), NavDecision::Observe);

        let root = Url::parse("https://example.com/").unwrap();
        assert_eq!(decide_navigation(&root, TEST_TOKEN), NavDecision::Observe);
    }

    #[test]
    fn preview_tokens_are_not_reused_across_generations() {
        // Not a security property by itself (the token isn't secret once you
        // know the algorithm), just a sanity check that the counter/clock/pid
        // mix actually varies call to call instead of collapsing to a
        // constant.
        let a = generate_preview_token();
        let b = generate_preview_token();
        assert_ne!(a, b);
    }
}
