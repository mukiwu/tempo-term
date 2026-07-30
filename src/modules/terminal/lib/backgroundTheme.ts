import type { ITheme } from "@xterm/xterm";
import { backgroundSurfaceAlphas } from "@/lib/backgroundAppearance";
import { getTheme } from "@/themes/themes";

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
  backgroundOpacity: number,
  textColor: string | null = null,
  backgroundPaintedByHost = false,
): ITheme {
  const theme = getTheme(themeId);
  if (backgroundOpacity <= 0 || !theme.terminal.background) {
    return theme.terminal;
  }
  return {
    ...theme.terminal,
    background: hexToRgba(
      theme.terminal.background,
      backgroundPaintedByHost
        ? 0
        : backgroundSurfaceAlphas(themeId, backgroundOpacity).surface,
    ),
    ...(textColor ? { foreground: textColor } : {}),
  };
}
