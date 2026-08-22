import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { IS_WINDOWS } from "@/lib/platform";

/**
 * Native proxy scrollbars for the CodeMirror surfaces, VS Code layout.
 *
 * The real scrollbars have two problems the CSS can't fix: the horizontal
 * bar spans the whole scroller, running beneath the sticky line-number
 * gutter; and in the diff view the editors are auto-height (the outer
 * .cm-mergeView owns vertical scrolling), so the horizontal bar sits at the
 * bottom of the whole document, out of sight. So the scroller's own bars are
 * hidden and replaced with thin overflow strips — the browser renders real
 * native scrollbars for them — pinned where VS Code puts them: horizontal at
 * the pane's bottom starting after the gutter, vertical at the right edge.
 * Strip and scroller get equal scroll ranges, so positions map 1:1 with no
 * math on scroll events.
 *
 * Windows only: WebView2's classic scrollbars are always visible, making the
 * misplaced bars a real problem there. macOS/Linux keep the stock behaviour
 * and their native overlay scrollbars.
 */

export interface ProxyScrollbarsHandle {
  /** Re-measure and reposition the strips (call on geometry changes). */
  refresh(): void;
  destroy(): void;
}

interface ProxyScrollbarsOptions {
  /** Element whose scrollLeft/scrollTop moves. */
  scroller: HTMLElement;
  /** Positioned ancestor the strips live in; the pane the bars pin to. */
  host: HTMLElement;
  /** "x" when vertical scrolling lives on an outer container (the diff view),
   * "xy" for self-scrolling editors. */
  axes: "x" | "xy";
}

const NOOP: ProxyScrollbarsHandle = { refresh() {}, destroy() {} };

/** Native classic scrollbar thickness, measured once with a probe element. */
let barThickness = -1;
function scrollbarThickness(): number {
  if (barThickness < 0) {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;visibility:hidden;width:60px;height:60px;overflow:scroll";
    document.body.appendChild(probe);
    barThickness = probe.offsetWidth - probe.clientWidth;
    probe.remove();
  }
  return barThickness;
}

export function attachProxyScrollbars({
  scroller,
  host,
  axes,
}: ProxyScrollbarsOptions): ProxyScrollbarsHandle {
  if (!IS_WINDOWS) {
    return NOOP;
  }
  // The class both scopes the CSS that hides the scroller's own bars and
  // marks that replacements exist.
  host.classList.add("proxy-scrollbar-host");

  const makeStrip = (direction: "horizontal" | "vertical") => {
    const strip = document.createElement("div");
    strip.className = `proxy-scrollbar ${direction}`;
    const spacer = document.createElement("div");
    strip.appendChild(spacer);
    host.appendChild(strip);
    return { strip, spacer };
  };
  const h = makeStrip("horizontal");
  const v = axes === "xy" ? makeStrip("vertical") : null;
  if (v) {
    v.strip.style.width = `${scrollbarThickness()}px`;
  }

  // Cache the applied geometry so scroll handlers can call refresh every
  // frame without causing style churn.
  const last = {
    left: NaN,
    width: NaN,
    bottom: NaN,
    hSpacer: NaN,
    vSpacer: NaN,
    hShown: true,
    vShown: true,
  };
  const refresh = () => {
    // Re-assert the host class: React rewrites className when e.g. the theme
    // class on the editor wrapper changes, wiping foreign classes.
    host.classList.add("proxy-scrollbar-host");
    const gutter = scroller.querySelector<HTMLElement>(".cm-gutters")?.offsetWidth ?? 0;
    // No real horizontal overflow (word wrap, short lines): no bar at all.
    // Decided from the scroller itself so strip-width rounding can't leave a
    // phantom 1px scroll range.
    const hShown = scroller.scrollWidth - scroller.clientWidth > 1;
    if (hShown !== last.hShown) {
      last.hShown = hShown;
      h.strip.style.display = hShown ? "" : "none";
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    // Leave the corner square to the vertical bar, like native scrollbars do.
    const vOverflow = v !== null && scroller.scrollHeight > scroller.clientHeight + 1;
    const left = scrollerRect.left - hostRect.left + gutter;
    const width = Math.max(
      0,
      scrollerRect.width - gutter - (vOverflow ? scrollbarThickness() : 0),
    );
    // Pin to the pane's bottom edge, but when the document ends inside the
    // pane (a short diff) sit right under the content instead — where the
    // native bar would be. Always 0 for self-scrolling editors.
    const bottom = Math.max(0, hostRect.bottom - scrollerRect.bottom);
    // Subtract the same insets as the strip width so both scroll ranges stay
    // equal — otherwise the corner reservation leaves a phantom range that
    // shows a scrollbar even when nothing overflows (e.g. word wrap on).
    const hSpacer = Math.max(
      0,
      scroller.scrollWidth - gutter - (vOverflow ? scrollbarThickness() : 0),
    );
    if (left !== last.left) {
      last.left = left;
      h.strip.style.left = `${left}px`;
    }
    if (width !== last.width) {
      last.width = width;
      h.strip.style.width = `${width}px`;
    }
    if (bottom !== last.bottom) {
      last.bottom = bottom;
      h.strip.style.bottom = `${bottom}px`;
    }
    if (hSpacer !== last.hSpacer) {
      last.hSpacer = hSpacer;
      h.spacer.style.width = `${hSpacer}px`;
    }
    if (v) {
      // Hide outright when nothing really overflows: layout heights are
      // fractional but the spacer is set from the integer scrollHeight, and
      // that sub-pixel difference alone is enough to make the browser draw
      // a (pointless, full-thumb) scrollbar.
      const vShown = vOverflow;
      if (vShown !== last.vShown) {
        last.vShown = vShown;
        v.strip.style.display = vShown ? "" : "none";
      }
      const vSpacer = scroller.scrollHeight;
      if (vSpacer !== last.vSpacer) {
        last.vSpacer = vSpacer;
        v.spacer.style.height = `${vSpacer}px`;
      }
    }
    syncFromScroller();
  };

  // Mutual sync can't loop: assigning an unchanged scroll position fires no
  // scroll event.
  const syncFromScroller = () => {
    if (h.strip.scrollLeft !== scroller.scrollLeft) {
      h.strip.scrollLeft = scroller.scrollLeft;
    }
    if (v && v.strip.scrollTop !== scroller.scrollTop) {
      v.strip.scrollTop = scroller.scrollTop;
    }
  };
  const syncFromH = () => {
    if (scroller.scrollLeft !== h.strip.scrollLeft) {
      scroller.scrollLeft = h.strip.scrollLeft;
    }
  };
  const syncFromV = () => {
    if (v && scroller.scrollTop !== v.strip.scrollTop) {
      scroller.scrollTop = v.strip.scrollTop;
    }
  };
  scroller.addEventListener("scroll", syncFromScroller, { passive: true });
  h.strip.addEventListener("scroll", syncFromH, { passive: true });
  v?.strip.addEventListener("scroll", syncFromV, { passive: true });

  // In the diff view, vertical scrolling (on the outer .cm-mergeView) moves
  // the document's end through the pane, which shifts where the horizontal
  // strip should sit.
  const verticalScroller = scroller.closest(".cm-mergeView");
  verticalScroller?.addEventListener("scroll", refresh, { passive: true });

  // The scroll ranges move whenever the pane resizes, the rendered content's
  // widest line changes, or the gutter grows another digit.
  const observer = new ResizeObserver(refresh);
  observer.observe(host);
  observer.observe(scroller);
  for (const selector of [".cm-content", ".cm-gutters"]) {
    const el = scroller.querySelector(selector);
    if (el) {
      observer.observe(el);
    }
  }
  refresh();

  return {
    refresh,
    destroy() {
      observer.disconnect();
      scroller.removeEventListener("scroll", syncFromScroller);
      verticalScroller?.removeEventListener("scroll", refresh);
      h.strip.remove();
      v?.strip.remove();
    },
  };
}

/**
 * CodeMirror wiring for self-scrolling editors (the editor tab): proxy bars
 * for both axes, refreshed whenever the editor's geometry changes.
 */
export function proxyScrollbars(): Extension {
  return ViewPlugin.define((view) => {
    // The host must be the wrapper around the editor, not view.dom itself:
    // CodeMirror rewrites view.dom's className on update, which would strip
    // the proxy-scrollbar-host class (and with it the CSS hiding the native
    // bars). The wrapper only exists once the view is appended, so attach
    // lazily.
    let handle: ProxyScrollbarsHandle | null = null;
    // A reconfigure can swap this plugin out before the queued microtask runs.
    // destroy() has no handle to release at that point, so without this flag
    // the microtask would go on to attach strips nothing owns any more.
    let destroyed = false;
    const ensure = () => {
      if (!destroyed && !handle && view.dom.parentElement) {
        handle = attachProxyScrollbars({
          scroller: view.scrollDOM,
          host: view.dom.parentElement,
          axes: "xy",
        });
      }
    };
    queueMicrotask(ensure);
    return {
      update(update) {
        ensure();
        if (update.geometryChanged) {
          handle?.refresh();
        }
      },
      destroy() {
        destroyed = true;
        handle?.destroy();
      },
    };
  });
}
