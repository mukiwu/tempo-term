/**
 * Hover hint for a CodeMirror gutter icon. Fixed-positioned on the body like
 * components/Tooltip.tsx rather than a CSS `::after`: in a split diff the
 * gutters sit inside an `overflow: hidden` half that would clip an in-flow
 * tooltip, and `title` is unreliable in the macOS WebView. Styling lives in
 * index.css as `.cm-gutter-hint`.
 */
/** How often an open hint checks that its icon is still in the document. */
const ORPHAN_CHECK_MS = 250;

export function withGutterHint<T extends HTMLElement>(el: T, label: string): T {
  let tip: HTMLElement | null = null;
  let orphanCheck: number | null = null;
  const hide = () => {
    if (orphanCheck !== null) {
      window.clearInterval(orphanCheck);
      orphanCheck = null;
    }
    tip?.remove();
    tip = null;
  };
  el.addEventListener("mouseenter", () => {
    if (tip) {
      return;
    }
    tip = document.createElement("div");
    tip.className = "cm-gutter-hint";
    tip.textContent = label;
    document.body.appendChild(tip);
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
