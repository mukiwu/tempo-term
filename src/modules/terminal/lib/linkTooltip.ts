/**
 * A single shared hover tooltip for terminal links. xterm has no native
 * tooltip, so the web-links addon's hover/leave callbacks drive this. One
 * element is reused across all terminals (only one can be hovered at a time).
 */
let el: HTMLDivElement | null = null;

function ensureEl(): HTMLDivElement {
  if (el) {
    return el;
  }
  const node = document.createElement("div");
  node.className = "terminal-link-tooltip";
  node.setAttribute("aria-hidden", "true");
  document.body.appendChild(node);
  el = node;
  return node;
}

/** Longest tooltip we render; enough for any sane path or URL. */
const MAX_TOOLTIP_CHARS = 200;

/**
 * The tooltip's job is to show where a link REALLY points, and its input is
 * attacker-chosen (OSC 8 URIs decode to arbitrary text). Strip control and
 * format characters — a bidi override (U+202E) would visually reorder the
 * shown path into a different one — and bound the length so a huge URI can't
 * blanket the screen.
 */
function sanitizeTooltipText(text: string): string {
  const cleaned = text.replace(/[\p{Cc}\p{Cf}]/gu, "");
  return cleaned.length > MAX_TOOLTIP_CHARS
    ? `${cleaned.slice(0, MAX_TOOLTIP_CHARS)}…`
    : cleaned;
}

export function showLinkTooltip(text: string, x: number, y: number): void {
  const node = ensureEl();
  node.textContent = sanitizeTooltipText(text);
  node.style.left = `${x + 12}px`;
  node.style.top = `${y + 12}px`;
  node.style.display = "block";
}

export function hideLinkTooltip(): void {
  if (el) {
    el.style.display = "none";
  }
}
