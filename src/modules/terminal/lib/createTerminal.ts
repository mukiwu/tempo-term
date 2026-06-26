import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { openUrl } from "@tauri-apps/plugin-opener";
import { buildTerminalFontFamily } from "@/modules/fonts/lib/fontChain";
import { isWebUrl } from "@/lib/url";
import { IS_MAC, matchesOpenModifier } from "@/lib/platform";
import { hideLinkTooltip, showLinkTooltip } from "./linkTooltip";
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
  search: SearchAddon;
}

export interface CreateTerminalOptions {
  fontFamily?: string;
  fontSize?: number;
  theme?: ITheme;
  /** Hover hint shown over web links (e.g. "Cmd / Ctrl-click to open"). */
  linkHint?: string;
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

  const search = new SearchAddon();
  term.loadAddon(search);
  // Open web links in the system browser (not the in-app webview) on a
  // modifier-click, matching the file-link gesture (Alt/Cmd) plus Ctrl for
  // non-mac. A plain click is left for text selection. Hover shows a hint.
  term.loadAddon(
    new WebLinksAddon(
      (event, uri) => {
        if (matchesOpenModifier(event, IS_MAC) && isWebUrl(uri)) {
          void openUrl(uri);
        }
      },
      {
        hover: (event) => {
          if (options.linkHint) {
            showLinkTooltip(options.linkHint, event.clientX, event.clientY);
          }
        },
        leave: () => hideLinkTooltip(),
      },
    ),
  );

  const unicode11 = new Unicode11Addon();
  term.loadAddon(unicode11);
  // Use the Unicode 11 width tables so full-width CJK characters occupy two
  // cells and the cursor never drifts out of alignment.
  term.unicode.activeVersion = "11";

  return { term, fit, search };
}

/**
 * Switch the terminal to the WebGL (GPU-accelerated) renderer. Must run after
 * `term.open()`, because the addon needs the terminal's mounted canvas.
 *
 * WebGL can be unavailable or fail mid-session: no GPU / headless environment,
 * a blocked context, or the OS reclaiming the context on sleep/wake. In every
 * failure case we drop back to xterm's default DOM renderer so the terminal
 * keeps working rather than going blank. Returns the addon while it is active
 * (so the caller may dispose it), or `null` when we fell back to DOM.
 */
export function enableWebglRenderer(term: Terminal): WebglAddon | null {
  try {
    const addon = new WebglAddon();
    // A lost GPU context leaves a blank canvas; dispose the addon so xterm
    // reattaches its DOM renderer.
    addon.onContextLoss(() => addon.dispose());
    term.loadAddon(addon);
    return addon;
  } catch {
    return null;
  }
}
