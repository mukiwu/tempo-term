/**
 * Hover hint for a CodeMirror gutter icon. Fixed-positioned on the body like
 * components/Tooltip.tsx rather than a CSS `::after`: in a split diff the
 * gutters sit inside an `overflow: hidden` half that would clip an in-flow
 * tooltip, and `title` is unreliable in the macOS WebView. Styling lives in
 * index.css as `.cm-gutter-hint`.
 */
export function withGutterHint<T extends HTMLElement>(el: T, label: string): T {
  let tip: HTMLElement | null = null;
  const hide = () => {
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
  });
  el.addEventListener("mouseleave", hide);
  el.addEventListener("mousedown", hide);
  return el;
}
