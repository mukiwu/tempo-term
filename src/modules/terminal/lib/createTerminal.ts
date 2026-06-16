import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

/**
 * Default monospace stack with Traditional Chinese fallbacks baked in, so CJK
 * glyphs render even before the user customises fonts in settings (phase 2
 * makes this configurable).
 */
export const DEFAULT_TERMINAL_FONT_FAMILY = [
  '"JetBrains Mono"',
  '"Sarasa Mono TC"',
  '"Noto Sans Mono CJK TC"',
  '"PingFang TC"',
  '"Microsoft JhengHei"',
  "ui-monospace",
  "monospace",
].join(", ");

const DARK_THEME: ITheme = {
  background: "#0a0d12",
  foreground: "#e6edf3",
  cursor: "#4493f8",
  cursorAccent: "#0a0d12",
  selectionBackground: "#2f4868",
  black: "#0a0d12",
  red: "#f85149",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#4493f8",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ff7b72",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

export interface TerminalHandle {
  term: Terminal;
  fit: FitAddon;
}

export interface CreateTerminalOptions {
  fontFamily?: string;
  fontSize?: number;
}

export function createTerminal(options: CreateTerminalOptions = {}): TerminalHandle {
  const term = new Terminal({
    fontFamily: options.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize: options.fontSize ?? 13,
    lineHeight: 1.2,
    cursorBlink: true,
    allowProposedApi: true,
    theme: DARK_THEME,
    scrollback: 10000,
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());

  const unicode11 = new Unicode11Addon();
  term.loadAddon(unicode11);
  // Use the Unicode 11 width tables so full-width CJK characters occupy two
  // cells and the cursor never drifts out of alignment.
  term.unicode.activeVersion = "11";

  return { term, fit };
}
