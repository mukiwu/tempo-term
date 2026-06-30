/**
 * Builds the CSS font-family stack that xterm.js uses.
 *
 * Browsers resolve fonts per glyph: for each character they pick the first
 * family in the list that actually contains it. So the order matters a lot in
 * a terminal. A Latin-capable monospace font must come BEFORE any (often
 * proportional) CJK font, otherwise Latin characters get drawn by the CJK
 * font and lose their fixed width, making text look scattered.
 *
 * Order: user's primary monospace, then Latin monospace anchors, then the
 * Traditional Chinese fallback (and a CJK safety net), then generic monospace.
 * xterm forces every CJK glyph into two cells via the Unicode 11 width tables,
 * so a proportional CJK fallback still aligns to the grid.
 */

export interface FontChainInput {
  primary?: string;
  /**
   * Optional icon/Powerline font (e.g. a Nerd Font) consulted AFTER the Latin
   * monospace anchors. Sitting after the anchors (not before) means that when
   * `primary` is empty the system default (Menlo / ui-monospace) still wins
   * for ASCII; the icon font only catches the Private Use Area glyphs that
   * none of the anchors carry.
   */
  iconFallback?: string;
  cjkFallback?: string;
}

/** Generic CSS keywords and tokens that must never be quoted. */
const GENERIC_FAMILIES = new Set([
  "monospace",
  "serif",
  "sans-serif",
  "system-ui",
  "ui-monospace",
]);

/** Latin monospace anchors, tried before any CJK font so ASCII stays fixed-width. */
export const LATIN_MONO_ANCHORS = [
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Consolas",
];

/** CJK safety net so Chinese still resolves even before detection runs. */
export const CJK_FALLBACKS = [
  "Sarasa Mono TC",
  "Noto Sans Mono CJK TC",
  "PingFang TC",
  "Microsoft JhengHei",
];

export function quoteFamily(family: string): string {
  const name = family.trim();
  if (GENERIC_FAMILIES.has(name)) {
    return name;
  }
  // Single hyphenated/identifier tokens are valid unquoted; anything with
  // whitespace must be quoted.
  return /\s/.test(name) ? `"${name}"` : name;
}

export function buildTerminalFontFamily(input: FontChainInput): string {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | undefined) => {
    const name = raw?.trim();
    if (!name) {
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    ordered.push(quoteFamily(name));
  };

  push(input.primary);
  for (const anchor of LATIN_MONO_ANCHORS) {
    push(anchor);
  }
  push(input.iconFallback);
  push(input.cjkFallback);
  for (const fallback of CJK_FALLBACKS) {
    push(fallback);
  }
  push("monospace");

  return ordered.join(", ");
}

/**
 * Sentinel `userIconFallback` value: the user explicitly opted out of the
 * icon font slot. Distinct from `""` (auto-detect, use the suggested family).
 * Without this, an empty string would be falsy and `||` would silently fall
 * back to the detected suggestion, making the "None" option a no-op.
 */
export const ICON_FALLBACK_DISABLED = "none";

/**
 * Resolve the effective terminal font stack from user preferences and the
 * system-detected suggestions. For both the icon fallback and the CJK fallback,
 * an explicit user choice wins; an empty user value falls back to whatever the
 * backend detected (a Nerd Font for icons, a CJK monospace family for CJK).
 *
 * Icon fallback has a third state: the sentinel `ICON_FALLBACK_DISABLED`
 * (`"none"`) skips the suggestion too, so the user can turn the slot off
 * even when the backend detected a Nerd Font on the system.
 */
export function terminalFontFamilyFor(
  primary: string,
  userCjkFallback: string,
  suggestedCjkFallback: string | null,
  userIconFallback: string = "",
  suggestedIconFallback: string | null = null,
): string {
  const cjk = userCjkFallback.trim() || suggestedCjkFallback || undefined;
  const icon =
    userIconFallback === ICON_FALLBACK_DISABLED
      ? undefined
      : userIconFallback.trim() || suggestedIconFallback || undefined;
  return buildTerminalFontFamily({
    primary: primary.trim() || undefined,
    iconFallback: icon,
    cjkFallback: cjk ?? undefined,
  });
}
