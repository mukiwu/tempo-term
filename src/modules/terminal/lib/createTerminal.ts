import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { buildTerminalFontFamily } from "@/modules/fonts/lib/fontChain";
import "@xterm/xterm/css/xterm.css";

/**
 * Default monospace stack: Latin monospace anchors first, then Traditional
 * Chinese fallbacks, so CJK glyphs render while ASCII stays fixed-width even
 * before the user customises fonts in settings. Single source of truth is the
 * font-chain builder.
 */
export const DEFAULT_TERMINAL_FONT_FAMILY = buildTerminalFontFamily({});

export interface TerminalHandle {
  term: Terminal;
  fit: FitAddon;
}

export interface CreateTerminalOptions {
  fontFamily?: string;
  fontSize?: number;
  theme?: ITheme;
}

export function createTerminal(options: CreateTerminalOptions = {}): TerminalHandle {
  const term = new Terminal({
    fontFamily: options.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize: options.fontSize ?? 13,
    // Keep the default line height (1.0). A larger value spreads the rows
    // apart and the text looks scattered.
    cursorBlink: true,
    allowProposedApi: true,
    theme: options.theme,
    scrollback: 10000,
    // Otherwise xterm consumes Alt+click to move the cursor, which swallows the
    // Alt+click that opens file links.
    altClickMovesCursor: false,
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
