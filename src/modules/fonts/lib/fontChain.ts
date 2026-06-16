/**
 * Builds the CSS font-family stack that xterm.js uses. The strategy mirrors
 * Warp's layered fallback but expressed in the terminology a webview
 * understands: the user's primary monospace font first, a Traditional Chinese
 * monospace fallback next so every CJK glyph resolves, then a safe base chain
 * that always ends in the generic `monospace` keyword.
 */

export interface FontChainInput {
  primary?: string;
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

/**
 * Always-present tail so the terminal renders even with no font configured.
 * Latin monospace first, then a CJK safety net (so Traditional Chinese still
 * resolves before the generic keyword even when detection has not run), and
 * finally the generic `monospace` keyword.
 */
export const BASE_MONO_FALLBACKS = [
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Consolas",
  "Sarasa Mono TC",
  "Noto Sans Mono CJK TC",
  "PingFang TC",
  "Microsoft JhengHei",
  "monospace",
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
  push(input.cjkFallback);
  for (const fallback of BASE_MONO_FALLBACKS) {
    push(fallback);
  }

  return ordered.join(", ");
}

/**
 * Resolve the effective terminal font stack from user preferences and the
 * system-detected suggestion. An explicit CJK fallback choice wins; otherwise
 * fall back to whatever CJK monospace font the backend detected.
 */
export function terminalFontFamilyFor(
  primary: string,
  userCjkFallback: string,
  suggestedCjkFallback: string | null,
): string {
  const cjk = userCjkFallback.trim() || suggestedCjkFallback || undefined;
  return buildTerminalFontFamily({
    primary: primary.trim() || undefined,
    cjkFallback: cjk ?? undefined,
  });
}
