/**
 * Hover hint for a CodeMirror gutter icon. Fixed-positioned on the body like
 * components/Tooltip.tsx rather than a CSS `::after`: in a split diff the
 * gutters sit inside an `overflow: hidden` half that would clip an in-flow
 * tooltip, and `title` is unreliable in the macOS WebView. Styling lives in
 * index.css as `.cm-gutter-hint`.
 */
/** How often an open hint checks that its icon is still in the document. */
const ORPHAN_CHECK_MS = 250;

/** The hint attached to an element, for anyone who has to reach back into it. */
interface Hint {
  tip: HTMLElement | null;
  read: () => string;
  hide: () => void;
}

const hints = new WeakMap<HTMLElement, Hint>();

export function withGutterHint<T extends HTMLElement>(
  el: T,
  /** Read when the pointer arrives, not when the hint is attached: a control
   * whose label changes as it is pressed keeps the same element. */
  label: string | (() => string),
): T {
  let orphanCheck: number | null = null;
  const read = () => (typeof label === "string" ? label : label());
  const hide = () => {
    if (orphanCheck !== null) {
      window.clearInterval(orphanCheck);
      orphanCheck = null;
    }
    state.tip?.remove();
    state.tip = null;
  };
  const state: Hint = { tip: null, read, hide };
  hints.set(el, state);
  el.addEventListener("mouseenter", () => {
    if (state.tip) {
      return;
    }
    const text = read();
    // Nothing to say, so nothing to show: a control that will not act should
    // not describe an act.
    if (!text) {
      return;
    }
    const tip = document.createElement("div");
    tip.className = "cm-gutter-hint";
    tip.textContent = text;
    document.body.appendChild(tip);
    state.tip = tip;
    const rect = el.getBoundingClientRect();
    tip.style.left = `${rect.right + 6}px`;
    tip.style.top = `${rect.top + rect.height / 2 - tip.offsetHeight / 2}px`;
    // The icon can be destroyed with the pointer still on it — the editors
    // rebuild, or in the all-changes view a file scrolls out of the mounted
    // window entirely. A removed element never fires mouseleave, so without
    // this the hint is stranded on the body for the rest of the session.
    orphanCheck = window.setInterval(() => {
      if (!el.isConnected) {
        hide();
      }
    }, ORPHAN_CHECK_MS);
  });
  el.addEventListener("mouseleave", hide);
  el.addEventListener("mousedown", hide);
  return el;
}

/**
 * Re-read a hint that is already showing.
 *
 * A press from the keyboard never moves the pointer, so nothing dismisses the
 * hint the way `mousedown` does — and a control whose label changes under the
 * press would go on promising what it has already done.
 */
export function refreshGutterHint(el: HTMLElement): void {
  const state = hints.get(el);
  if (!state?.tip) {
    return;
  }
  const text = state.read();
  if (text) {
    state.tip.textContent = text;
  } else {
    state.hide();
  }
}
