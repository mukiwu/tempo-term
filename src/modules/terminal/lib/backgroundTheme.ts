import type { ITheme } from "@xterm/xterm";
import { getTheme } from "@/themes/themes";

const DARK_TERMINAL_SURFACE_ALPHA = 0.82;
const LIGHT_TERMINAL_SURFACE_ALPHA = 0.88;

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) {
    return hex;
  }
  const [, red, green, blue] = match;
  return `rgba(${Number.parseInt(red, 16)}, ${Number.parseInt(green, 16)}, ${Number.parseInt(
    blue,
    16,
  )}, ${alpha})`;
}

/** Keep xterm's palette intact while letting the app-managed image show through. */
export function terminalThemeWithBackground(
  themeId: string,
  backgroundActive: boolean,
): ITheme {
  const theme = getTheme(themeId);
  if (!backgroundActive || !theme.terminal.background) {
    return theme.terminal;
  }
  const alpha =
    theme.appearance === "light"
      ? LIGHT_TERMINAL_SURFACE_ALPHA
      : DARK_TERMINAL_SURFACE_ALPHA;
  return {
    ...theme.terminal,
    background: hexToRgba(theme.terminal.background, alpha),
  };
}
