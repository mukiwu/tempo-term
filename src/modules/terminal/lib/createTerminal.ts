import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import { buildTerminalFontFamily } from "@/modules/fonts/lib/fontChain";
import { isLocalUrl, isWebUrl } from "@/lib/url";
import { IS_MAC, IS_WINDOWS, matchesOpenModifier } from "@/lib/platform";
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

/**
 * Convert a file:// URI from an OSC 8 link into a filesystem path, or "" when
 * the URI doesn't name a plain local file. OSC 8 URIs are attacker-supplied
 * (anything that prints to the terminal), so this rejects rather than guesses.
 * On Windows the URL pathname keeps a leading slash before the drive letter
 * (file:///C:/x -> /C:/x), which the fs commands reject.
 */
export function fileUriToPath(uri: string, isWindows: boolean = IS_WINDOWS): string {
  let path: string;
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") {
      return "";
    }
    // A remote host would either vanish from pathname (file://host/x -> /x)
    // or come back as a UNC target; reject rather than open something other
    // than what the link claims to be.
    if (url.host && url.host !== "localhost") {
      return "";
    }
    path = decodeURIComponent(url.pathname);
  } catch {
    path = uri.replace(/^file:\/\/(?:localhost)?/i, "");
  }
  if (isWindows && /^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1);
  }
  // Accept only plain absolute paths. A leading double slash (or backslash)
  // is a UNC host on Windows — opening one fires an SMB connection at an
  // attacker-chosen machine — and anything relative is not a file link.
  return /^(?:[A-Za-z]:[\\/]|\/(?![/\\]))/.test(path) ? path : "";
}

export interface CreateTerminalOptions {
  fontFamily?: string;
  fontSize?: number;
  theme?: ITheme;
  /** Hover hint shown over web links (e.g. "Cmd / Ctrl-click to open"). */
  linkHint?: string;
  /**
   * Open a localhost/IP web URL in the in-app preview. When provided, local
   * URLs route here on modifier-click instead of opening the system browser;
   * external URLs always go to the browser.
   */
  onOpenLocalUrl?: (url: string) => void;
  /**
   * Fired when an OSC 8 file link (e.g., file:///...) is modifier-clicked.
   */
  onOpenFileUrl?: (url: string) => void;
}

export function createTerminal(options: CreateTerminalOptions = {}): TerminalHandle {
  const term = new Terminal({
    fontFamily: options.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize: options.fontSize ?? 13,
    // Keep the default line height (1.0). A larger value spreads the rows
    // apart and the text looks scattered.
    cursorBlink: true,
    // xterm requires transparency support to be chosen before open() and does
    // not allow changing it later. Background-image settings are live, so keep
    // the renderer capable and use an opaque theme whenever no image is active.
    allowTransparency: true,
    allowProposedApi: true,
    theme: options.theme,
    scrollback: 10000,
    // Otherwise xterm consumes Alt+click to move the cursor, which swallows the
    // Alt+click that opens file links.
    altClickMovesCursor: false,
    linkHandler: {
      // Without this xterm's built-in OSC 8 provider drops every non-http(s)
      // URI before the handler runs, so file:// links would never activate.
      // Safe to enable: activate only acts on web and file:// URIs, requires a
      // modifier-click, and file links open read-only in the editor pane.
      allowNonHttpProtocols: true,
      activate: (event, uri) => {
        if (!matchesOpenModifier(event, IS_MAC)) {
          return;
        }
        if (isWebUrl(uri)) {
          if (options.onOpenLocalUrl && isLocalUrl(uri)) {
            options.onOpenLocalUrl(uri);
          } else {
            void openUrl(uri);
          }
        } else if (/^file:/i.test(uri) && options.onOpenFileUrl) {
          const path = fileUriToPath(uri);
          if (path) {
            options.onOpenFileUrl(path);
          }
        }
      },
      hover: (event, uri) => {
        // OSC 8 display text can lie about its target, so always surface the
        // real one (the resolved path for file links) alongside the hint.
        const target = /^file:/i.test(uri) ? fileUriToPath(uri) || uri : uri;
        showLinkTooltip(
          options.linkHint ? `${target} (${options.linkHint})` : target,
          event.clientX,
          event.clientY,
        );
      },
      leave: () => hideLinkTooltip(),
    },
  });

  const fit = new FitAddon();
  term.loadAddon(fit);

  const search = new SearchAddon();
  term.loadAddon(search);
  // Open web links on a modifier-click, matching the file-link gesture (Alt/Cmd)
  // plus Ctrl for non-mac. A plain click is left for text selection. Local
  // (localhost/IP) URLs go to the in-app preview when a handler is wired;
  // everything else opens in the system browser. Hover shows a hint.
  term.loadAddon(
    new WebLinksAddon(
      (event, uri) => {
        if (!matchesOpenModifier(event, IS_MAC) || !isWebUrl(uri)) {
          return;
        }
        if (options.onOpenLocalUrl && isLocalUrl(uri)) {
          options.onOpenLocalUrl(uri);
        } else {
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

  // No GPU (WebGL) renderer: xterm falls back to its built-in DOM renderer when
  // no WebGL/Canvas addon is loaded. WebGL's texture-atlas glyph cache renders
  // unreliably inside macOS WKWebView (garbled / overlapping glyphs on first
  // paint and after DPR changes), so we deliberately stay on the DOM renderer
  // for correctness.
  return { term, fit, search };
}
