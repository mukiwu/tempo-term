import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { debounce } from "@/lib/debounce";
import { useSettingsStore } from "@/stores/settingsStore";
import { resolvePreviewSrc } from "../lib/resolvePreviewSrc";
import { previewWebviewLabel } from "../lib/previewWebview";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Options {
  /** URL or local path to preview. A change navigates the existing webview. */
  url: string;
  /** The owning pane's leaf id; part of the unique webview label. */
  leafId: string;
  /**
   * Whether the webview should be shown. The native webview floats above all
   * DOM, so the caller hides it whenever the pane is not the foremost thing on
   * screen (inactive tab/space, split drag, or an open overlay).
   */
  visible: boolean;
  /**
   * Called when the page navigates (link click, redirect, or address-bar load)
   * so the owning pane can follow the url in the address bar and persist it.
   * Local-file (asset://) targets are not reported.
   */
  onNavigate?: (url: string) => void;
  /** Called when the page's `<title>` changes so the owning tab can retitle. */
  onTitle?: (title: string) => void;
}

interface TitleEvent {
  label: string;
  title: string;
}

interface NavigatedEvent {
  label: string;
  url: string;
}

// React StrictMode double-invokes effects (mount → unmount → mount) in dev, and
// creation/teardown of the native webview is async — so a naive "create on
// mount, close on cleanup" races itself into a closed or duplicated webview.
// Two module-level, label-keyed guards make the lifecycle idempotent:
//  - `creatingWebviews`: coalesces concurrent create requests so a double-mount
//    never builds two webviews with the same label.
//  - `pendingCloses`: defers the close so a fast remount can cancel it and adopt
//    the still-alive webview instead of tearing it down and rebuilding.
const creatingWebviews = new Map<string, Promise<void>>();
const pendingCloses = new Map<string, ReturnType<typeof setTimeout>>();
const CLOSE_DELAY_MS = 100;

/** Create the webview once per label; concurrent callers share one request. */
function ensurePreviewWebview(label: string, url: string, rect: Rect): Promise<void> {
  const existing = creatingWebviews.get(label);
  if (existing) {
    return existing;
  }
  const inflight = invoke<void>("preview_create", { label, url, ...rect })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`[preview] failed to create webview "${label}":`, e);
    })
    .finally(() => {
      creatingWebviews.delete(label);
    });
  creatingWebviews.set(label, inflight);
  return inflight;
}

function rectOf(el: HTMLElement | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // A hidden ancestor (`display:none`) collapses the host to zero — there is no
  // valid place to put the webview yet, so report nothing and keep it hidden.
  if (r.width <= 0 || r.height <= 0) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Manage a native Tauri child webview that renders a preview inside a pane.
 *
 * Unlike an `<iframe>`, the child webview is a native layer composited over the
 * window — so it ignores `X-Frame-Options`/`frame-ancestors` (it can show
 * wp-admin etc.), but it is NOT part of the DOM: it must be positioned, shown,
 * and hidden manually to track the pane.
 *
 * The webview is CREATED in Rust (`preview_create`) so it can attach the
 * builder-only callbacks the JS API lacks: page-title changes and navigation
 * tracking, both surfaced here as events. Once created, its JS handle (via
 * `Webview.getByLabel`) is used for positioning/show/hide, and the `preview_*`
 * commands drive navigate/reload/back/forward without recreating it — which is
 * what keeps the back/forward history intact.
 *
 * A child webview's position is relative to the window in logical pixels and is
 * NOT affected by the main webview's zoom. The app zooms the main webview via
 * `setZoom(uiZoom)` (App.tsx), so `getBoundingClientRect()` returns page CSS
 * pixels whose on-screen size is `value * uiZoom` window-logical pixels. We
 * therefore multiply the host rect by `uiZoom` before positioning the child.
 *
 * Returns the host ref plus navigate/reload/back/forward controls.
 */
export function useNativePreviewWebview({ url, leafId, visible, onNavigate, onTitle }: Options) {
  const hostRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<Webview | null>(null);
  const visibleRef = useRef(visible);
  const shownRef = useRef(false);
  const lastRectRef = useRef<Rect | null>(null);
  // The last src we asked the webview to load, so a url-prop change only
  // navigates when it is genuinely different (and never re-loads the initial).
  const loadedSrcRef = useRef<string | null>(null);
  // The latest url prop, readable inside the creation effect's async closure
  // (which otherwise captures a stale url). Lets us catch up if the url changes
  // while the webview is still being built — see the creation effect below.
  const latestUrlRef = useRef(url);
  latestUrlRef.current = url;
  const uiZoom = useSettingsStore((s) => s.uiZoom);
  const zoomRef = useRef(uiZoom);
  const onNavigateRef = useRef(onNavigate);
  const onTitleRef = useRef(onTitle);

  visibleRef.current = visible;
  zoomRef.current = uiZoom;
  onNavigateRef.current = onNavigate;
  onTitleRef.current = onTitle;

  const label = previewWebviewLabel(getCurrentWindow().label, leafId);

  // Push the webview to match the host's current rect and visibility. Cheap to
  // call often: it no-ops unless something actually changed.
  const sync = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    if (!visibleRef.current) {
      if (shownRef.current) {
        shownRef.current = false;
        void webview.hide().catch(() => {});
      }
      return;
    }

    const rect = rectOf(hostRef.current);
    if (!rect) return;

    if (!sameRect(rect, lastRectRef.current)) {
      lastRectRef.current = rect;
      // The host rect is in zoomed page pixels; the child webview lives in
      // unzoomed window pixels, so scale by the UI zoom factor.
      //
      // Position and size go through ONE Rust command on purpose. The JS
      // setPosition + setSize pair is two IPC messages, and each is a
      // read-modify-write of the full bounds inside tauri's runtime; on Windows
      // the write lands asynchronously, so the second message could read back —
      // and re-commit — a rect the first write had not applied yet, freezing
      // the webview at its creation-time size with an L-shaped gap (#163).
      const z = zoomRef.current;
      void invoke("preview_set_bounds", {
        label,
        x: rect.x * z,
        y: rect.y * z,
        width: rect.width * z,
        height: rect.height * z,
      }).catch(() => {});
    }
    if (!shownRef.current) {
      shownRef.current = true;
      void webview.show().catch(() => {});
    }
  }, [label]);

  // A zoom change keeps the host rect (page px) the same but moves/resizes its
  // on-screen footprint, so force a reposition when uiZoom changes.
  useEffect(() => {
    lastRectRef.current = null;
    sync();
  }, [uiZoom, sync]);

  // Create the webview once per pane. A url change navigates it (below) rather
  // than recreating, so its history survives. StrictMode-safe via the module
  // guards above.
  useEffect(() => {
    let cancelled = false;
    // A pending close from a just-unmounted instance (StrictMode remount) would
    // tear this webview down; cancel it so we adopt the live one.
    const pending = pendingCloses.get(label);
    if (pending) {
      clearTimeout(pending);
      pendingCloses.delete(label);
    }

    const z = zoomRef.current;
    const initial = rectOf(hostRef.current);
    const src = resolvePreviewSrc(url);
    // Always pass a rect (in unzoomed window pixels); start at 1×1 when the host
    // is not measurable so nothing flashes before the first sync shows it.
    const rect: Rect = {
      x: initial ? initial.x * z : 0,
      y: initial ? initial.y * z : 0,
      width: initial ? initial.width * z : 1,
      height: initial ? initial.height * z : 1,
    };

    void (async () => {
      let webview = await Webview.getByLabel(label).catch(() => null);
      if (!webview) {
        loadedSrcRef.current = src;
        await ensurePreviewWebview(label, src, rect);
        if (cancelled) return;
        webview = await Webview.getByLabel(label).catch(() => null);
      }
      if (cancelled || !webview) return;
      loadedSrcRef.current ??= src;
      webviewRef.current = webview;
      shownRef.current = false;
      lastRectRef.current = null;
      sync();

      // If the url prop changed while the webview was being built, the navigate
      // effect ran too early (webviewRef was still null) and bailed. Reconcile
      // now so that in-flight change isn't lost.
      const latestSrc = resolvePreviewSrc(latestUrlRef.current);
      if (latestSrc !== loadedSrcRef.current) {
        loadedSrcRef.current = latestSrc;
        void invoke("preview_navigate", { label, url: latestSrc }).catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
      webviewRef.current = null;
      shownRef.current = false;
      lastRectRef.current = null;
      // Defer the close so a StrictMode remount (or fast re-mount) can cancel it
      // and re-adopt the webview instead of destroying and rebuilding it.
      const existing = pendingCloses.get(label);
      if (existing) clearTimeout(existing);
      pendingCloses.set(
        label,
        setTimeout(() => {
          pendingCloses.delete(label);
          loadedSrcRef.current = null;
          void invoke("preview_close", { label }).catch(() => {});
        }, CLOSE_DELAY_MS),
      );
    };
    // Only leafId (via label) recreates the webview; url is handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, sync]);

  // Navigate the existing webview when the url prop changes (e.g. a file dropped
  // onto this pane). Skips the initial load and any no-op change.
  useEffect(() => {
    if (!webviewRef.current) return;
    const src = resolvePreviewSrc(url);
    if (src === loadedSrcRef.current) return;
    loadedSrcRef.current = src;
    void invoke("preview_navigate", { label, url: src }).catch(() => {});
  }, [url, label]);

  // Subscribe to the Rust-side title/navigation events for this webview.
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const track = (p: Promise<() => void>) => {
      void p.then((un) => {
        if (disposed) un();
        else unlisteners.push(un);
      });
    };
    track(
      listen<TitleEvent>("preview://title", (e) => {
        if (e.payload.label === label) {
          onTitleRef.current?.(e.payload.title);
        }
      }),
    );
    track(
      listen<NavigatedEvent>("preview://navigated", (e) => {
        if (e.payload.label !== label) return;
        const next = e.payload.url;
        loadedSrcRef.current = next;
        // Local-file previews load through asset://; keep the typed file path in
        // the address bar rather than replacing it with the asset url.
        if (!next.startsWith("asset:")) {
          onNavigateRef.current?.(next);
        }
      }),
    );
    return () => {
      disposed = true;
      unlisteners.forEach((un) => un());
    };
  }, [label]);

  // Re-sync after every render: a split can move the pane without resizing it,
  // which a ResizeObserver would miss. sync() no-ops when nothing changed.
  useLayoutEffect(() => {
    sync();
  });

  // Track size changes (divider drag, window resize) that happen without a
  // React render. Debounced so a fast drag does not spam IPC. The native window
  // resize event is included because a maximize may not surface a DOM resize.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const syncSoon = debounce(sync, 16);
    const observer = new ResizeObserver(syncSoon);
    observer.observe(host);
    window.addEventListener("resize", syncSoon);
    const unlistenResized = getCurrentWindow().onResized(() => syncSoon());
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncSoon);
      void unlistenResized.then((un) => un());
      syncSoon.cancel();
    };
  }, [sync]);

  const reload = useCallback(() => {
    void invoke("preview_reload", { label }).catch(() => {});
  }, [label]);
  const back = useCallback(() => {
    void invoke("preview_history_back", { label }).catch(() => {});
  }, [label]);
  const forward = useCallback(() => {
    void invoke("preview_history_forward", { label }).catch(() => {});
  }, [label]);

  return { hostRef, reload, back, forward };
}
