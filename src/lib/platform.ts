/**
 * Single source of truth for platform detection and the link-open gesture.
 * Mac opens links on Alt or Cmd; Windows and other non-mac on Alt or Ctrl.
 *
 * navigator.platform is deprecated and may be undefined in some runtimes, so we
 * guard it with optional chaining and fall back to userAgent to avoid throwing
 * at module load.
 */
export const IS_MAC =
  typeof navigator !== "undefined" &&
  (navigator.platform?.toLowerCase().includes("mac") ||
    navigator.userAgent?.toLowerCase().includes("mac") ||
    false);

/**
 * Windows detection. Used to swap in a custom title bar (the native one is
 * hidden via decorations, while macOS keeps its overlay title bar) and to route
 * terminal Ctrl+V through the same smart paste flow as macOS (text wins, else a
 * copied file's path). Linux has no native clipboard backend yet, so it keeps
 * xterm's built-in paste.
 */
export const IS_WINDOWS =
  typeof navigator !== "undefined" &&
  // platform is "Win32"/"Win64" on Windows; the userAgent says "Windows". Match
  // the userAgent on the full word, not "win", so "darwin" (e.g. jsdom's UA)
  // doesn't false-positive.
  (navigator.platform?.toLowerCase().includes("win") ||
    navigator.userAgent?.toLowerCase().includes("windows") ||
    false);

type ModifierEvent = Pick<MouseEvent, "altKey" | "metaKey" | "ctrlKey">;

/** Whether a click carries the platform's open-link modifier. */
export function matchesOpenModifier(
  event: ModifierEvent,
  isMac: boolean = IS_MAC,
): boolean {
  return isMac
    ? event.altKey || event.metaKey
    : event.altKey || event.ctrlKey;
}

/** Modifier-key label shown in the link hover tooltip. */
export function openModifierLabel(isMac: boolean = IS_MAC): string {
  return isMac ? "Alt / Cmd" : "Alt / Ctrl";
}

/**
 * Whether a click (or Enter) asks for a new tab instead of the sidebar's
 * default, which is to split the active tab.
 *
 * Deliberately not `matchesOpenModifier`: that one is the terminal's
 * link-activation gesture and counts Alt, which nowhere means "new tab". This
 * is the plain Cmd/Ctrl-click that browsers, editors and Finder all share.
 *
 * Splitting on mac rather than on `IS_WINDOWS` is intentional here (cf. the
 * windows-tauri rule against mac-vs-everything-else gates): Ctrl-click is the
 * new-tab gesture on Windows *and* Linux, so the non-mac arm is the real
 * Windows path, not a fallback that leaves it without one. Both arms are
 * asserted in platform.test.ts.
 */
export function matchesNewTabModifier(
  event: ModifierEvent,
  isMac: boolean = IS_MAC,
): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}
