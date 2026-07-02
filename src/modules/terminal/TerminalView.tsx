import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardPaste, Copy, Loader2, WifiOff } from "lucide-react";
import { consumeFreshSshLeaf } from "@/modules/ssh/lib/freshSshLeaves";
import { createTerminal, type TerminalHandle } from "./lib/createTerminal";
import { createOutputWriter } from "./lib/outputWriter";
import { SearchBar } from "./SearchBar";
import { openPty, type PtySession } from "./lib/pty-bridge";
import { openSsh, type SshSession } from "@/modules/ssh/lib/ssh-bridge";
import { useForwardStatusStore } from "@/modules/ssh/lib/forwardStatusStore";
import { liveSessionsStore } from "@/modules/ssh/lib/liveSessionsStore";

/** Narrows a session to PtySession (which has cwd/foregroundCommand). */
function isPtySession(s: PtySession | SshSession): s is PtySession {
  return "cwd" in s;
}

/**
 * True for the global shortcuts the app handles at the window level (⌘/Ctrl+1-9
 * switch tab, ⌥1-9 switch sidebar, ⌘/Ctrl +/-/0 zoom the UI). `code` is used
 * over `key` so it still matches when a modifier rewrites the character (macOS
 * ⌥1 yields "¡"). The terminal must let these pass through to the window handler
 * rather than typing them into the shell.
 */
function isAppShortcut(event: KeyboardEvent): boolean {
  const cmd = event.metaKey || event.ctrlKey;
  if (/^(?:Digit|Numpad)[1-9]$/.test(event.code)) {
    const switchTab = cmd && !event.shiftKey && !event.altKey;
    const switchSidebar = event.altKey && !event.metaKey && !event.ctrlKey;
    return switchTab || switchSidebar;
  }
  if (/^(?:Equal|Minus|Digit0|NumpadAdd|NumpadSubtract|Numpad0|Backquote)$/.test(event.code)) {
    return cmd && !event.altKey;
  }
  return false;
}
import { useConnectionsStore } from "@/stores/connectionsStore";
import {
  deleteTerminalHistory,
  dropRestoredPrefix,
  loadTerminalHistory,
  saveTerminalHistory,
  serializeBufferText,
  trimScrollback,
  MAX_SCROLLBACK_LINES,
  SESSION_SEPARATOR,
} from "./lib/terminalHistory";
import {
  registerTerminal,
  registerTerminalPathDrop,
  registerTerminalReader,
  unregisterTerminal,
  unregisterTerminalPathDrop,
  unregisterTerminalReader,
} from "./lib/terminalBus";
import { imageFilesFromDrop, pathsFromDrop } from "./lib/terminalDrop";
import {
  formatPathsForTerminal,
  prepareClipboardImageAttachment,
  resolvePasteAction,
  saveDroppedImage,
  terminalClipboardImagePaths,
  terminalClipboardPaths,
  terminalClipboardText,
  shouldAttachImage,
  shellQuotePath,
} from "./lib/terminalClipboard";
import {
  buildFileLink,
  findFilePaths,
  resolveFilePath,
  wrappedPathCandidates,
  TRAILING_PATH_RE,
} from "./lib/fileLinks";
import { actionsFor, findActionLinks, type TerminalAction } from "./lib/actionLinks";
import { ActionCard } from "./ActionCard";
import { buildCellPositions, gatherLogicalLine } from "./lib/cellPositions";
import { terminalKeySequence } from "./lib/terminalKeymap";
import { shouldCdToRoot } from "./lib/cwdSync";
import { parseOsc7Cwd } from "./lib/osc7";
import { debounce } from "@/lib/debounce";
import { dropOverlayClassName } from "@/components/EntryDropOverlay";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { fsHomeDir, fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { getDraggedEntry } from "@/modules/explorer/lib/dragEntry";
import {
  STATUS_OSC_CODE,
  isClaudeForeground,
  isCodexForeground,
  parseStatusOsc,
} from "@/modules/claude-progress/lib/sessionStatus";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";

import { IS_MAC, IS_WINDOWS, openModifierLabel } from "@/lib/platform";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabsStore } from "@/stores/tabsStore";
import { getTheme } from "@/themes/themes";

// The home dir never changes within a session; fetch it once and share it so
// `~/…` paths in terminal output can be expanded.
let homeDirCache: string | null = null;
async function getHomeDir(): Promise<string | null> {
  if (homeDirCache === null) {
    try {
      homeDirCache = await fsHomeDir();
    } catch {
      homeDirCache = "";
    }
  }
  return homeDirCache;
}

/** Human-readable byte size for the overload notice (e.g. 12 KB, 3.4 MB). */
function formatSkipped(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

interface TerminalViewProps {
  active: boolean;
  /** Whether the tab hosting this pane is the currently visible tab. */
  isActiveTab?: boolean;
  /** When true, this pane drives the file explorer root from its shell CWD. */
  cwdTracking?: boolean;
  /** Directory the shell starts in. */
  cwd?: string;
  /** SSH connection info, when this pane hosts an SSH session instead of a local PTY. */
  ssh?: { connectionId: string };
  /** Pane id, so notes/workflows can run commands into this terminal. */
  leafId?: string;
  onExit?: () => void;
  /** Report the shell's current directory so it can be restored next launch. */
  onCwdChange?: (cwd: string) => void;
  /** Alt+click on a file path in the output opens it (with the resolved abs path). */
  onOpenFile?: (absolutePath: string) => void;
  /** Open a localhost/IP URL from a terminal action card in the in-app preview. */
  onOpenPreview?: (url: string) => void;
}

export function TerminalView({
  active,
  isActiveTab = true,
  cwdTracking = false,
  cwd,
  ssh,
  leafId,
  onExit,
  onCwdChange,
  onOpenFile,
  onOpenPreview,
}: TerminalViewProps) {
  const leafIdRef = useRef(leafId);
  leafIdRef.current = leafId;
  const activeRef = useRef(active);
  activeRef.current = active;
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  const sessionRef = useRef<PtySession | SshSession | null>(null);
  const sshRef = useRef(ssh);
  sshRef.current = ssh;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;
  const onOpenPreviewRef = useRef(onOpenPreview);
  onOpenPreviewRef.current = onOpenPreview;
  // Windows' cwd source: the latest directory the shell reported via OSC 7
  // (see lib/osc7.ts). The mount-time handler below keeps the ref fresh and
  // notifies the cwd-tracking effect through osc7ApplyRef while this pane
  // drives the explorer. Unused on macOS/Linux, which poll the OS instead.
  const osc7CwdRef = useRef<string | null>(null);
  const osc7ApplyRef = useRef<((dir: string) => void) | null>(null);
  // Holds a deferred "start the SSH session now" function that is set inside the
  // main mount effect and called by the reconnect button for restored panes.
  const connectNowRef = useRef<(() => void) | null>(null);
  const { t } = useTranslation();
  const linkHintRef = useRef(t("openLinkHint", { mods: openModifierLabel(IS_MAC) }));
  linkHintRef.current = t("openLinkHint", { mods: openModifierLabel(IS_MAC) });

  const fontFamily = useFontStore(selectTerminalFontFamily);
  const fontSize = useFontStore((s) => s.fontSize);
  const themeId = useSettingsStore((s) => s.themeId);
  const terminalPadding = useSettingsStore((s) => s.terminalPadding);
  const [connecting, setConnecting] = useState(true);
  // For SSH panes restored after an app relaunch: the freshSshLeaves set is empty,
  // so those panes must not auto-connect. This flag shows the Reconnect UI instead.
  const [sshDisconnected, setSshDisconnected] = useState(false);
  // Incrementing this counter (via the Reconnect button) re-triggers the connect
  // effect for restored SSH panes without touching any other path.
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const [externalFileDragging, setExternalFileDragging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Skipped-bytes total shown in the overload notice, or null when hidden. The
  // refs throttle visible updates during a flood and auto-hide once it settles.
  const [outputSkipped, setOutputSkipped] = useState<number | null>(null);
  // The writer reports a lifetime cumulative dropped total; the baseline marks
  // the total when the last notice closed, so each notice shows just this
  // overload event's skipped bytes rather than an ever-growing lifetime sum.
  const skippedTotalRef = useRef(0);
  const skippedBaselineRef = useRef(0);
  const skippedShowTimer = useRef<number | null>(null);
  const skippedHideTimer = useRef<number | null>(null);
  const dragDepthRef = useRef(0);
  const nativeDragPathsRef = useRef<string[]>([]);
  // Right-click menu position; null when closed. Exposes Copy/Paste that run the
  // same fast clipboard path as the keyboard shortcuts (see `pasteRef`), instead
  // of the WebView2 native menu whose paste is slow.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);
  // Lets the right-click menu call the in-effect smart-paste handler.
  const pasteRef = useRef<((kind: "ctrl" | "cmd") => void) | null>(null);
  // The hover action card (IP / host:port / archive quick commands), positioned
  // at the cursor. A short hide delay lets the pointer travel from the link into
  // the card without it vanishing.
  const [actionCard, setActionCard] = useState<{
    actions: TerminalAction[];
    x: number;
    y: number;
  } | null>(null);
  const actionCardTimer = useRef<number | null>(null);

  const cancelActionCardHide = () => {
    if (actionCardTimer.current !== null) {
      clearTimeout(actionCardTimer.current);
      actionCardTimer.current = null;
    }
  };
  const showActionCard = (actions: TerminalAction[], x: number, y: number) => {
    cancelActionCardHide();
    setActionCard({ actions, x, y });
  };
  const scheduleActionCardHide = () => {
    cancelActionCardHide();
    actionCardTimer.current = window.setTimeout(() => setActionCard(null), 180);
  };
  const runActionCommand = (command: string) => {
    void sessionRef.current?.write(`${command}\r`);
    cancelActionCardHide();
    setActionCard(null);
    handleRef.current?.term.focus();
  };
  const openActionPreview = (url: string) => {
    onOpenPreviewRef.current?.(url);
    cancelActionCardHide();
    setActionCard(null);
  };

  // Surface the overload notice when the output writer sheds data. Visible
  // updates are throttled so a sustained flood doesn't itself thrash React, and
  // the notice auto-hides once output stops being dropped.
  const noteDroppedOutput = (total: number) => {
    skippedTotalRef.current = total;
    if (skippedShowTimer.current === null) {
      skippedShowTimer.current = window.setTimeout(() => {
        skippedShowTimer.current = null;
        setOutputSkipped(skippedTotalRef.current - skippedBaselineRef.current);
      }, 250);
    }
    if (skippedHideTimer.current !== null) {
      clearTimeout(skippedHideTimer.current);
    }
    skippedHideTimer.current = window.setTimeout(() => {
      setOutputSkipped(null);
      skippedBaselineRef.current = skippedTotalRef.current;
    }, 2500);
  };

  // Clear any pending action-card hide timer when the pane unmounts so it can't
  // fire a state update on a gone component.
  useEffect(() => {
    return () => {
      if (actionCardTimer.current !== null) {
        clearTimeout(actionCardTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const containerEl = container;

    const initial = useFontStore.getState();
    const handle = createTerminal({
      fontFamily: selectTerminalFontFamily(initial),
      fontSize: initial.fontSize,
      theme: getTheme(useSettingsStore.getState().themeId).terminal,
      linkHint: linkHintRef.current,
      onOpenLocalUrl: (url) => onOpenPreviewRef.current?.(url),
    });
    handleRef.current = handle;
    const { term, fit } = handle;
    term.open(container);

    // Batch live PTY/SSH output through a frame-scheduled writer so a flood
    // (cat a huge file, runaway logs) can't block the UI thread. One-shot writes
    // (restored history, error notices) still go straight to the terminal.
    const outputWriter = createOutputWriter({
      write: (chunk) => term.write(chunk),
      onDrop: (total) => noteDroppedOutput(total),
    });

    // The session-status hook (see claude_status_hook) emits OSC 6973 on this
    // pane's tty when Claude changes state. Capture it here, where we know the
    // leaf id, and feed the per-leaf status store that drives the card badge.
    const statusOscHandler = term.parser.registerOscHandler(STATUS_OSC_CODE, (payload) => {
      const leaf = leafIdRef.current;
      if (leaf) {
        const parsed = parseStatusOsc(payload);
        if (parsed?.kind === "status") {
          useSessionStatusStore.getState().setStatus(leaf, parsed.status);
        } else if (parsed?.kind === "end") {
          useSessionStatusStore.getState().clear(leaf);
        }
      }
      return true; // consume so the sequence never reaches the screen
    });

    // On Windows the injected shell integration reports the shell's cwd with
    // OSC 7 at every prompt (see lib/osc7.ts for why Windows can't poll the OS
    // the way macOS/Linux do). Record it for session restore and pane
    // activation, and forward it live to the cwd-tracking effect. SSH panes are
    // skipped like the polling path skips them — a remote cwd means nothing to
    // the local explorer, and parseOsc7Cwd rejects non-local reports anyway.
    const osc7Handler = IS_WINDOWS
      ? term.parser.registerOscHandler(7, (payload) => {
          if (!sshRef.current) {
            const dir = parseOsc7Cwd(payload);
            if (dir) {
              osc7CwdRef.current = dir;
              // Remember this pane's own cwd for session restore (store dedupes).
              onCwdChangeRef.current?.(dir);
              osc7ApplyRef.current?.(dir);
            }
          }
          return true; // consume so the sequence never reaches the screen
        })
      : null;

    async function handleTerminalPaste(kind: "ctrl" | "cmd") {
      const session = sessionRef.current;
      if (!session) {
        return;
      }
      // Text wins, so read it first and skip the (costlier) path/image probes
      // when a normal copy is on the clipboard. Each probe spawns a macOS
      // helper (osascript/ps), so fetch them lazily and in order: file paths
      // shadow images in resolvePasteAction, and the foreground command only
      // matters when there is exactly one path that could be an attachment.
      const clipboardText = await terminalClipboardText().catch(() => "");
      let filePaths: string[] = [];
      let imagePaths: string[] = [];
      let command: string | null = null;
      if (!clipboardText) {
        filePaths = await terminalClipboardPaths().catch(() => []);
        if (filePaths.length === 0) {
          imagePaths = await terminalClipboardImagePaths().catch(() => []);
        }
        if (filePaths.length === 1 || imagePaths.length === 1) {
          command = isPtySession(session)
            ? await session.foregroundCommand().catch(() => null)
            : null;
        }
      }
      const action = resolvePasteAction({
        shortcut: kind,
        clipboardText,
        filePaths,
        imagePaths,
        foregroundCommand: command,
      });
      switch (action.kind) {
        case "text":
          term.paste(action.text);
          break;
        case "attach-image":
          await prepareClipboardImageAttachment(action.path).catch(() => {});
          await session.write("\x16");
          break;
        case "paste-paths":
          term.paste(formatPathsForTerminal(action.paths));
          break;
        case "control":
          await session.write("\x16");
          break;
        case "none":
          break;
      }
    }
    pasteRef.current = handleTerminalPaste;

    function isTerminalPasteShortcut(event: KeyboardEvent): "ctrl" | "cmd" | null {
      const isV = event.code === "KeyV" || event.key.toLowerCase() === "v";
      if (!isV || event.altKey || event.shiftKey) {
        return null;
      }
      if (IS_MAC && event.ctrlKey && !event.metaKey) {
        return "ctrl";
      }
      if (IS_MAC && event.metaKey && !event.ctrlKey) {
        return "cmd";
      }
      // Windows: Ctrl+V runs the same smart paste (text wins, else file paths)
      // via handleTerminalPaste. Linux is intentionally excluded — it has no
      // native clipboard backend, so it keeps xterm's built-in paste.
      if (IS_WINDOWS && event.ctrlKey && !event.metaKey) {
        return "ctrl";
      }
      return null;
    }

    function interceptTerminalPaste(event: KeyboardEvent): boolean {
      if (!activeRef.current || event.type !== "keydown") {
        return false;
      }
      const target = event.target;
      // Let inputs inside the pane (e.g. the search bar) handle their own paste
      // rather than redirecting it into the shell.
      if (target instanceof HTMLInputElement) {
        return false;
      }
      if (target instanceof Node && !containerEl.contains(target)) {
        return false;
      }
      const kind = isTerminalPasteShortcut(event);
      if (!kind) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void handleTerminalPaste(kind);
      return true;
    }

    const onKeyDownCapture = (event: KeyboardEvent) => {
      interceptTerminalPaste(event);
    };
    document.addEventListener("keydown", onKeyDownCapture, true);

    const onPasteCapture = (event: ClipboardEvent) => {
      const target = event.target;
      // Let inputs inside the pane (e.g. the search bar) keep their own paste.
      if (target instanceof HTMLInputElement) {
        return;
      }
      if (!activeRef.current || (target instanceof Node && !containerEl.contains(target))) {
        return;
      }
      // macOS and Windows route paste through handleTerminalPaste (Ctrl/Cmd+V
      // in the custom key handler), so the native event must be suppressed here
      // to avoid a double paste. Linux has no custom paste handler, so let the
      // event reach xterm's built-in paste — suppressing it there is what made
      // Ctrl+V do nothing on Linux.
      if (!IS_MAC && !IS_WINDOWS) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      // Keyboard Ctrl/Cmd+V already preventDefaults on keydown, so this native
      // paste event only fires for a non-keyboard paste (right-click or the Edit
      // menu). Route it through the smart-paste flow so those paths work too,
      // with no double paste. "cmd" keeps an empty clipboard a no-op rather than
      // injecting the raw paste control byte.
      void handleTerminalPaste("cmd");
    };
    document.addEventListener("paste", onPasteCapture, true);

    // Drop keydown events that belong to an active IME composition so the
    // composed text is only delivered once, through xterm's compositionend
    // path. Chromium reports keyCode 229 for keys pressed during composition,
    // and modern browsers set isComposing. Without this, switching the input
    // method mid-composition sends the text to the PTY twice.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && (event.isComposing || event.keyCode === 229)) {
        return false;
      }
      // App-level shortcuts (⌘/Ctrl+1-9 switch tab, ⌥1-9 switch sidebar,
      // ⌘/Ctrl +/-/0 zoom) must not be typed into the shell. Returning false
      // lets them bubble to the window handler instead; preventDefault stops
      // xterm's hidden textarea from emitting the character (e.g. macOS ⌥-symbols).
      if (event.type === "keydown" && isAppShortcut(event)) {
        event.preventDefault();
        return false;
      }
      // Open the in-terminal search bar. On mac Cmd+F is free; on other
      // platforms Ctrl+F is readline's forward-char, so use Ctrl+Shift+F to
      // avoid clobbering it.
      if (event.type === "keydown") {
        const isF = event.code === "KeyF" || event.key.toLowerCase() === "f";
        const findCombo = IS_MAC
          ? event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
          : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
        if (isF && findCombo) {
          event.preventDefault();
          setSearchOpen(true);
          // If the bar is already open (just unfocused), refocus and select it
          // so the shortcut is never a no-op.
          const input = containerEl.querySelector("input");
          if (input) {
            input.focus();
            input.select();
          }
          return false;
        }
      }
      // Standard terminal editing shortcuts (Shift+Enter, word/line nav, word
      // and line delete), matching common terminals so muscle memory carries over.
      if (event.type === "keydown") {
        const seq = terminalKeySequence(event, IS_MAC);
        if (seq) {
          // preventDefault is essential: without it xterm's hidden textarea
          // still receives the keystroke and emits its own bytes. For
          // Shift+Enter that means a bare CR sneaks through after our ESC CR
          // and submits the line. Matches common terminal behavior.
          event.preventDefault();
          void sessionRef.current?.write(seq);
          return false;
        }
        if (IS_MAC && event.ctrlKey && !event.metaKey && !event.altKey) {
          const isV = event.code === "KeyV" || event.key.toLowerCase() === "v";
          if (isV) {
            event.preventDefault();
            void handleTerminalPaste("ctrl");
            return false;
          }
        }
        // Clipboard on macOS: Cmd+C copies the selection, Cmd+V pastes.
        if (IS_MAC && event.metaKey && !event.ctrlKey && !event.altKey) {
          const k = event.key.toLowerCase();
          if (k === "c" && term.hasSelection()) {
            void navigator.clipboard.writeText(term.getSelection());
            return false;
          }
          if (event.code === "KeyV" || k === "v") {
            event.preventDefault();
            void handleTerminalPaste("cmd");
            return false;
          }
        }
      }
      return true;
    });

    // Alt+click a path in the output to open it. The path
    // is resolved against the live shell cwd and only opened if it really exists.
    async function openFromTerminal(raw: string) {
      let resolvedCwd: string | null = cwdRef.current ?? null;
      try {
        const s = sessionRef.current;
        const live = s && isPtySession(s) ? await s.cwd() : null;
        if (live) {
          resolvedCwd = live;
        }
      } catch {
        // fall back to the starting cwd
      }
      const abs = resolveFilePath(raw, resolvedCwd, await getHomeDir());
      try {
        await fsReadFile(abs);
        onOpenFileRef.current?.(abs);
      } catch {
        // not a real file (e.g. a bare domain) — ignore the click
      }
    }

    term.registerLinkProvider({
      provideLinks(lineNumber, callback) {
        const buffer = term.buffer.active;
        // Resolve the logical line (handles wrapped paths) and read its cells.
        const rows = gatherLogicalLine(buffer, lineNumber);
        if (!rows) {
          callback(undefined);
          return;
        }
        const { text, spans } = buildCellPositions(rows);
        const actionsEnabled = useSettingsStore.getState().actionLinksEnabled;
        const actionMatches = actionsEnabled ? findActionLinks(text) : [];
        // An archive filename also matches as a file path; drop the overlapping
        // file link so the action card wins (opening a binary archive as a file
        // is not useful anyway).
        const matches = findFilePaths(text).filter(
          (f) => !actionMatches.some((a) => f.start < a.end && f.end > a.start),
        );
        const lastSpan = spans[spans.length - 1];
        // Map a string index back to a buffer cell (1-based x/y). start uses the
        // glyph's first column; end uses its last, so wide glyphs are covered.
        const startCell = (index: number): { x: number; y: number } => {
          const span = spans[index] ?? lastSpan;
          return { x: span?.startX ?? 1, y: span?.y ?? lineNumber };
        };
        const endCell = (index: number): { x: number; y: number } => {
          const span = spans[index] ?? lastSpan;
          return { x: span?.endX ?? 1, y: span?.y ?? lineNumber };
        };
        const fileLinks = matches.map((m) =>
          buildFileLink({
            text: m.text,
            range: { start: startCell(m.start), end: endCell(m.end - 1) },
            hint: linkHintRef.current,
            isMac: IS_MAC,
            onOpen: (raw) => void openFromTerminal(raw),
          }),
        );

        // A program (e.g. an AI coding agent) can hard-wrap a long absolute path
        // across logical lines: the first ends mid-path, the next continues it
        // after indentation. Offer a link on each half that opens the rejoined
        // path. We avoid a cross-line range (an xterm minefield) by giving each
        // half its own single-line link pointing at the same rejoined path;
        // openFromTerminal validates existence on click, so a wrong join (this
        // joins broadly) simply won't open.
        const logicalText = (start: number): string | null => {
          const r = gatherLogicalLine(buffer, start);
          return r ? buildCellPositions(r).text : null;
        };
        const wrappedLinks: ReturnType<typeof buildFileLink>[] = [];
        const nextText = logicalText(rows[rows.length - 1].y + 1);
        if (nextText !== null) {
          for (const cand of wrappedPathCandidates(text, nextText)) {
            const tailMatch = text.match(TRAILING_PATH_RE);
            if (tailMatch && tailMatch.index !== undefined) {
              wrappedLinks.push(
                buildFileLink({
                  text: cand,
                  range: { start: startCell(tailMatch.index), end: endCell(text.length - 1) },
                  hint: linkHintRef.current,
                  isMac: IS_MAC,
                  onOpen: (raw) => void openFromTerminal(raw),
                }),
              );
            }
          }
        }
        const prevText = logicalText(rows[0].y - 1);
        if (prevText !== null) {
          for (const cand of wrappedPathCandidates(prevText, text)) {
            const lead = text.match(/^(\s*)([\p{L}\p{N}_.\-/]+)/u);
            if (lead) {
              const leadStart = lead[1].length;
              const leadEnd = leadStart + lead[2].length;
              wrappedLinks.push(
                buildFileLink({
                  text: cand,
                  range: { start: startCell(leadStart), end: endCell(leadEnd - 1) },
                  hint: linkHintRef.current,
                  isMac: IS_MAC,
                  onOpen: (raw) => void openFromTerminal(raw),
                }),
              );
            }
          }
        }

        const actionLinks = actionMatches.map((m) => ({
          text: m.text,
          range: { start: startCell(m.start), end: endCell(m.end - 1) },
          // Interaction happens through the hover card's buttons, so a click on
          // the link itself does nothing.
          activate: () => {},
          hover: (event: MouseEvent) => {
            showActionCard(actionsFor(m), event.clientX, event.clientY);
          },
          leave: () => {
            scheduleActionCardHide();
          },
        }));
        if (fileLinks.length === 0 && wrappedLinks.length === 0 && actionLinks.length === 0) {
          callback(undefined);
          return;
        }
        callback([...fileLinks, ...wrappedLinks, ...actionLinks]);
      },
    });

    const safeFit = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        try {
          fit.fit();
        } catch {
          // a hidden container can momentarily report zero size
        }
      }
    };

    let disposed = false;

    // Defer the initial fit to the next animation frame so the renderer has
    // time to compute cell dimensions. FitAddon returns early (no-op) when
    // cell.width is 0, which leaves the terminal at the default 80×24 and the
    // PTY spawns at 80 cols regardless of the actual pane width. The "tab
    // becomes active" useEffect already uses rAF for the same reason.
    let initialFitFrame: number;
    const initialFit = new Promise<void>((resolve) => {
      initialFitFrame = requestAnimationFrame(() => {
        safeFit();
        resolve();
      });
    });

    // Restore the saved scrollback (read-only history) before the shell starts,
    // so it appears above a fresh prompt. Gated on the user setting.
    const restoreHistory = async () => {
      const leafId = leafIdRef.current;
      if (!leafId || !useSettingsStore.getState().restoreTerminalHistory) {
        return;
      }
      const saved = await loadTerminalHistory(leafId).catch(() => null);
      if (disposed || !saved) {
        return;
      }
      // Plain logical lines; dim the whole block grey so it reads as history,
      // and convert "\n" to "\r\n" for the terminal. The separator line below
      // doubles as the boundary marker the snapshot strips on (see snapshot()),
      // so the restored block is never re-saved and never stacks duplicates.
      term.write(`\x1b[90m${saved.replace(/\n/g, "\r\n")}\x1b[0m\r\n`);
      term.write(`\x1b[90m${SESSION_SEPARATOR}\x1b[0m\r\n`);
    };

    const openSession = async (): Promise<PtySession | SshSession> => {
      const paneSsh = sshRef.current;
      if (paneSsh) {
        const conn = useConnectionsStore.getState().getConnection(paneSsh.connectionId);
        if (!conn) {
          throw new Error(`SSH connection "${paneSsh.connectionId}" not found — it may have been deleted.`);
        }
        const forwards = conn.portForwards
          ?.filter((pf) => pf.enabled)
          .map((pf) => ({
            id: pf.id,
            bindHost: pf.bindHost,
            localPort: pf.localPort,
            destHost: pf.destHost,
            destPort: pf.destPort,
          }));
        return openSsh({
          connectionId: conn.id,
          host: conn.host,
          port: conn.port,
          user: conn.user,
          authMethod: conn.authMethod,
          keyPath: conn.keyPath,
          cols: term.cols,
          rows: term.rows,
          forwards,
          onData: (bytes) => outputWriter.push(bytes),
          // Only treat an exit as user-facing when we did not tear the session
          // down ourselves (e.g. React StrictMode's mount/unmount/remount in dev).
          onExit: (_code) => {
            if (!disposed) {
              // Do NOT call onExitRef (which closes the pane). Instead, show the
              // Reconnect card so the user can retry after a failed/dropped connection.
              const sshSession = sessionRef.current as SshSession | null;
              void sessionRef.current?.close();
              if (sshSession) {
                useForwardStatusStore.getState().clearSession(sshSession.id);
                liveSessionsStore.getState().unregister(sshSession.id);
              }
              setSshDisconnected(true);
              setConnecting(false);
            }
          },
        });
      }
      return openPty({
        cols: term.cols,
        rows: term.rows,
        cwd: cwdRef.current,
        // Read the setting at spawn time so a restored pane reflects the current
        // value, instead of racing a global flag set after mount.
        suggestions: useSettingsStore.getState().terminalSuggestions,
        shellOverride: useSettingsStore.getState().customShellPath,
        onData: (bytes) => outputWriter.push(bytes),
        // Only treat an exit as user-facing when we did not tear the session
        // down ourselves (e.g. React StrictMode's mount/unmount/remount in dev).
        onExit: () => {
          if (!disposed) {
            onExitRef.current?.();
            // The shell ended while the app is running (e.g. the user typed
            // `exit`), so its history is no longer wanted. An app teardown sets
            // `disposed` first, so that path keeps the history for next launch.
            if (leafIdRef.current) {
              void deleteTerminalHistory(leafIdRef.current);
            }
          }
        },
      });
    };

    // History restore only applies to local PTY sessions.
    const beforeOpen = sshRef.current ? Promise.resolve() : restoreHistory();

    // Shared "open session and wire it up" logic, used both on first mount
    // (for fresh SSH and all PTY panes) and by the Reconnect button (for
    // restored SSH panes that skipped auto-connect on relaunch).
    function startSession() {
      void openSession()
      .then((session) => {
        if (disposed) {
          void session.close();
          return;
        }
        sessionRef.current = session;
        // Register live SSH session so ConnectionsPanel can show forwarding status.
        const paneSshConn = sshRef.current;
        if (paneSshConn && !isPtySession(session)) {
          liveSessionsStore.getState().register(paneSshConn.connectionId, session.id);
        }
        term.onData((data) => void session.write(data));
        if (leafIdRef.current) {
          registerTerminal(leafIdRef.current, (text) => void session.write(text));
          registerTerminalPathDrop(leafIdRef.current, (paths) => handlePathDrop(paths));
          // Let the AI panel pull this pane's scrollback as context. Reads the
          // tail so a long session does not serialize thousands of rows.
          registerTerminalReader(leafIdRef.current, () => serializeBufferText(term, 300));
        }
        // A freshly opened tracking pane drives the explorer to its start dir
        // right away instead of waiting for the next cwd poll. (Lets "open in
        // terminal" sync the explorer via the NEW pane, leaving others untouched.)
        if (cwdTracking && cwdRef.current) {
          useWorkspaceStore.getState().setRoot(cwdRef.current);
        }
        setSshDisconnected(false);
        setConnecting(false);
      })
      .catch((error: unknown) => {
        // If the pane unmounted before the spawn rejected, the terminal is
        // already disposed; writing to it would throw.
        if (disposed) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        term.write(`\r\n\x1b[31mFailed to open shell: ${message}\x1b[0m\r\n`);
        setConnecting(false);
      });
    }

    // Expose the connect function so the Reconnect button can call it after mount.
    connectNowRef.current = () => {
      if (disposed) {
        return;
      }
      setConnecting(true);
      startSession();
    };

    void Promise.all([beforeOpen, initialFit]).then(() => {
      if (disposed) {
        return;
      }
      // For SSH panes: only auto-connect if this leaf was freshly opened this
      // session (i.e. the user just clicked "Connect"). Restored panes after a
      // relaunch will not be in the set, so they show the Reconnect UI instead.
      if (sshRef.current) {
        const isFresh = leafIdRef.current
          ? consumeFreshSshLeaf(leafIdRef.current)
          : false;
        if (!isFresh) {
          // Restored SSH pane — show the Disconnected / Reconnect state.
          setSshDisconnected(true);
          setConnecting(false);
          return;
        }
      }
      startSession();
    });

    // Snapshot the scrollback periodically so a crash/quit loses at most a few
    // seconds. Overwrites the same per-pane file; gated on the user setting.
    // Only writes when the buffer actually changed since the last snapshot, so
    // an idle terminal does no work.
    let dirty = false;
    const writeListener = term.onWriteParsed(() => {
      dirty = true;
    });
    const snapshot = () => {
      const leafId = leafIdRef.current;
      if (!leafId || !dirty || !useSettingsStore.getState().restoreTerminalHistory) {
        return;
      }
      dirty = false;
      // Serialize the whole buffer first, then drop everything up to and
      // including the restore separator so only this session's live output is
      // persisted. Capping inside serializeBufferText could scroll the separator
      // out of view, so strip on the full text first, then trim for size.
      const live = dropRestoredPrefix(serializeBufferText(term), SESSION_SEPARATOR);
      const data = trimScrollback(live, MAX_SCROLLBACK_LINES);
      void saveTerminalHistory(leafId, data).catch(() => {
        dirty = true;
      });
    };
    const snapshotTimer = setInterval(snapshot, 5000);

    // Telling the PTY its new size sends SIGWINCH, which makes the shell repaint
    // its prompt. A divider drag fires this observer dozens of times a second, so
    // pushing every intermediate size spams the shell with reprinted prompts.
    // safeFit stays immediate (xterm reflows in step with the pane), but the PTY
    // resize is debounced to the size the drag settles on.
    const pushPtySize = debounce(() => {
      const session = sessionRef.current;
      if (session) {
        void session.resize(term.cols, term.rows);
      }
    }, 80);
    const observer = new ResizeObserver(() => {
      safeFit();
      pushPtySize();
    });
    observer.observe(container);

    return () => {
      disposed = true;
      outputWriter.dispose();
      if (skippedShowTimer.current !== null) clearTimeout(skippedShowTimer.current);
      if (skippedHideTimer.current !== null) clearTimeout(skippedHideTimer.current);
      cancelAnimationFrame(initialFitFrame);
      clearInterval(snapshotTimer);
      writeListener.dispose();
      observer.disconnect();
      pushPtySize.cancel();
      document.removeEventListener("keydown", onKeyDownCapture, true);
      document.removeEventListener("paste", onPasteCapture, true);
      statusOscHandler.dispose();
      osc7Handler?.dispose();
      if (leafIdRef.current) {
        unregisterTerminal(leafIdRef.current);
        unregisterTerminalPathDrop(leafIdRef.current);
        unregisterTerminalReader(leafIdRef.current);
        useSessionStatusStore.getState().clear(leafIdRef.current);
      }
      // Unregister live SSH session on pane close so the connections panel
      // no longer shows forwarding rows for this session.
      const closingSession = sessionRef.current;
      if (closingSession && !isPtySession(closingSession)) {
        useForwardStatusStore.getState().clearSession(closingSession.id);
        liveSessionsStore.getState().unregister(closingSession.id);
      }
      void sessionRef.current?.close();
      term.dispose();
      handleRef.current = null;
      sessionRef.current = null;
    };
  }, []);

  // When a background tab becomes visible again its container regains size, so
  // refit, push the new dimensions to the shell and grab focus. Keyed on
  // isActiveTab too: switching tabs does not change this pane's `active` flag
  // (it stays the tab's active leaf), so without it the effect would not re-run
  // and keyboard focus would be lost until the user clicks the terminal.
  useEffect(() => {
    if (!active || !isActiveTab) {
      return;
    }
    const handle = handleRef.current;
    const container = containerRef.current;
    if (!handle || !container) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        try {
          handle.fit.fit();
        } catch {
          // ignore transient zero-size
        }
        sessionRef.current?.resize(handle.term.cols, handle.term.rows);
      }
      handle.term.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, isActiveTab]);

  // Apply live font changes from the settings panel to an already-open terminal.
  useEffect(() => {
    const handle = handleRef.current;
    const container = containerRef.current;
    if (!handle || !container) {
      return;
    }
    handle.term.options.fontFamily = fontFamily;
    handle.term.options.fontSize = fontSize;
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      try {
        handle.fit.fit();
      } catch {
        // ignore transient zero-size
      }
      sessionRef.current?.resize(handle.term.cols, handle.term.rows);
    }
  }, [fontFamily, fontSize]);

  // Recolour an open terminal when the app theme changes.
  useEffect(() => {
    const handle = handleRef.current;
    if (handle) {
      handle.term.options.theme = getTheme(themeId).terminal;
    }
  }, [themeId]);

  // The pane's inner padding is configurable; re-fit so the grid recomputes.
  useEffect(() => {
    const handle = handleRef.current;
    const container = containerRef.current;
    if (!handle || !container) {
      return;
    }
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      try {
        handle.fit.fit();
      } catch {
        // ignore transient zero-size
      }
      sessionRef.current?.resize(handle.term.cols, handle.term.rows);
    }
  }, [terminalPadding]);

  // While this pane is the live one, follow its shell's working directory so
  // the file explorer tracks `cd`. SSH panes skip this entirely — they have no
  // cwd() or foregroundCommand() methods.
  useEffect(() => {
    if (!cwdTracking || sshRef.current) {
      return;
    }
    let cancelled = false;
    // Seed with the shell's starting dir so the mount-time setRoot (which fires
    // with this same dir) does not echo a redundant `cd` back into the shell.
    // Without this, a freshly opened pane that auto-runs a CLI (e.g. claude,
    // codex) gets the `cd` typed into that program's prompt instead.
    let last = cwdRef.current ?? "";
    // Force the explorer to follow this pane the first time it becomes the active
    // driver (e.g. after switching tab/space), even when its cwd hasn't changed.
    // Otherwise `dir === last` skips the setRoot below and the file tree stays on
    // the previously active tab's directory.
    let firstSync = true;
    const poll = async () => {
      const raw = sessionRef.current;
      const session = raw && isPtySession(raw) ? raw : null;
      if (!session) {
        return;
      }
      try {
        const dir = await session.cwd();
        if (cancelled || !dir) {
          return;
        }
        // Remember this pane's own cwd for session restore (store dedupes).
        onCwdChangeRef.current?.(dir);
        if (dir !== last || firstSync) {
          last = dir;
          useWorkspaceStore.getState().setRoot(dir);
        }
        firstSync = false;
        // While a pane shows a status, read its foreground process to (a) label
        // which agent is running, so a card can tell Claude from Codex even when
        // two panes share a directory, and (b) act as a crash backstop: if no
        // tracked agent is foreground, SessionEnd never arrived (e.g. a hard
        // kill) so the OSC never cleared it — clear the stale status here.
        const leaf = leafIdRef.current;
        if (leaf && useSessionStatusStore.getState().statuses[leaf]) {
          const command = await session.foregroundCommand().catch(() => null);
          if (!cancelled) {
            if (isClaudeForeground(command)) {
              useSessionStatusStore.getState().setAgent(leaf, "claude");
            } else if (isCodexForeground(command)) {
              useSessionStatusStore.getState().setAgent(leaf, "codex");
            } else {
              useSessionStatusStore.getState().clear(leaf);
            }
          }
        }
      } catch {
        // ignore transient failures
      }
    };
    // The cwd source differs per platform. macOS/Linux poll the OS for the
    // foreground process's cwd (pty_cwd — lsof//proc). Windows has no such
    // backend, so the injected shell integration reports the cwd with OSC 7 at
    // every prompt instead (see lib/osc7.ts); the mount-time handler forwards
    // each report here through osc7ApplyRef. Applying the last-known report on
    // registration covers pane activation, when the shell sits at its prompt
    // and won't re-emit until the next one — the counterpart of the poll's
    // firstSync pass.
    let timer: ReturnType<typeof setInterval> | undefined;
    let applyOsc7: ((dir: string) => void) | undefined;
    if (IS_WINDOWS) {
      applyOsc7 = (dir: string) => {
        if (cancelled) {
          return;
        }
        if (dir !== last || firstSync) {
          last = dir;
          useWorkspaceStore.getState().setRoot(dir);
        }
        firstSync = false;
      };
      osc7ApplyRef.current = applyOsc7;
      if (osc7CwdRef.current) {
        applyOsc7(osc7CwdRef.current);
      }
    } else {
      void poll();
      timer = setInterval(() => void poll(), 1200);
    }
    // React to every explorer-root change (from this poll OR from the explorer):
    // retitle the active tab to the new dir, and if the shell isn't already there
    // (i.e. the change came from the explorer, not the shell), cd it. Title sync
    // lives here, not in the poll's block, because an explorer-driven change sets
    // `last` first, so the poll never sees dir !== last for it.
    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      if (cancelled) {
        return;
      }
      const root = state.rootPath;
      if (!root) {
        return;
      }
      const activeId = useTabsStore.getState().activeId;
      if (activeId) {
        useTabsStore.getState().syncTabTitleToCwd(activeId, root);
      }
      if (shouldCdToRoot(root, last)) {
        last = root;
        void sessionRef.current?.write(`cd ${shellQuotePath(root)}\n`);
      }
    });
    return () => {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
      }
      if (applyOsc7 && osc7ApplyRef.current === applyOsc7) {
        osc7ApplyRef.current = null;
      }
      unsubscribe();
    };
  }, [cwdTracking]);

  // Snapshot the cwd when this pane stops being active (e.g. switching tabs), so
  // its last directory is saved between polls. SSH panes skip this — no cwd() method.
  useEffect(() => {
    if (active || sshRef.current) {
      return;
    }
    const raw = sessionRef.current;
    const session = raw && isPtySession(raw) ? raw : null;
    if (!session) {
      return;
    }
    void session
      .cwd()
      .then((dir) => {
        if (dir) {
          onCwdChangeRef.current?.(dir);
        }
      })
      .catch(() => {});
  }, [active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const pointInContainer = (x: number, y: number): boolean => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const points =
        dpr === 1
          ? [[x, y]]
          : [
              [x, y],
              [x / dpr, y / dpr],
            ];
      return points.some(
        ([lx, ly]) => lx >= rect.left && lx <= rect.right && ly >= rect.top && ly <= rect.bottom,
      );
    };

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (disposed) {
          return;
        }
        const payload = event.payload;
        if (payload.type === "leave") {
          nativeDragPathsRef.current = [];
          setExternalFileDragging(false);
          return;
        }
        if (payload.type === "enter") {
          const paths = payload.paths;
          nativeDragPathsRef.current = paths;
          setExternalFileDragging(
            paths.length > 0 && pointInContainer(payload.position.x, payload.position.y),
          );
          return;
        }
        if (!pointInContainer(payload.position.x, payload.position.y)) {
          setExternalFileDragging(false);
          return;
        }
        if (payload.type === "over") {
          setExternalFileDragging(nativeDragPathsRef.current.length > 0);
          return;
        }
        const paths = payload.paths;
        nativeDragPathsRef.current = [];
        setExternalFileDragging(false);
        if (paths.length > 0) {
          void handlePathDrop(paths);
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      nativeDragPathsRef.current = [];
      setExternalFileDragging(false);
      unlisten?.();
    };
  }, []);

  // When the user clicks Reconnect on a restored SSH pane, reconnectTrigger is
  // incremented. This effect wakes up and calls the deferred connect function
  // that was stored in connectNowRef during the main mount effect.
  useEffect(() => {
    if (reconnectTrigger === 0) {
      return;
    }
    connectNowRef.current?.();
  }, [reconnectTrigger]);

  // Match the padding gutter to the terminal's own background so the inset
  // reads as breathing room rather than a different-coloured frame.
  function isExternalFileDrag(data: DataTransfer): boolean {
    if (getDraggedEntry()) {
      return false;
    }
    return (
      Array.from(data.items).some((item) => item.kind === "file") ||
      data.files.length > 0 ||
      pathsFromDrop(data).length > 0
    );
  }

  async function handlePathDrop(paths: string[], files: File[] = []): Promise<boolean> {
    const session = sessionRef.current;
    const handle = handleRef.current;
    if (!session || !handle) {
      return false;
    }
    handle.term.focus();
    const resolvedPaths =
      paths.length > 0
        ? paths
        : await Promise.all(files.map((file) => saveDroppedImage(file).catch(() => "")));
    const filePaths = resolvedPaths.filter(Boolean);
    if (filePaths.length === 0) {
      return false;
    }
    const command = isPtySession(session)
      ? await session.foregroundCommand().catch(() => null)
      : null;
    if (shouldAttachImage(command, filePaths)) {
      await prepareClipboardImageAttachment(filePaths[0]).catch(() => {});
      await session.write("\x16");
      return true;
    }
    handle.term.paste(formatPathsForTerminal(filePaths));
    return true;
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      style={{
        padding: terminalPadding,
        backgroundColor: getTheme(themeId).terminal.background,
      }}
      onDragEnter={(event) => {
        if (nativeDragPathsRef.current.length > 0) {
          return;
        }
        if (!isExternalFileDrag(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        dragDepthRef.current += 1;
        setExternalFileDragging(true);
      }}
      onDragOver={(event) => {
        if (nativeDragPathsRef.current.length > 0) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          return;
        }
        if (!isExternalFileDrag(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setExternalFileDragging(true);
      }}
      onDragLeave={(event) => {
        if (nativeDragPathsRef.current.length > 0) {
          return;
        }
        if (!isExternalFileDrag(event.dataTransfer)) {
          return;
        }
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
          setExternalFileDragging(false);
        }
      }}
      onDrop={(event) => {
        if (nativeDragPathsRef.current.length > 0) {
          event.preventDefault();
          const paths = nativeDragPathsRef.current;
          nativeDragPathsRef.current = [];
          dragDepthRef.current = 0;
          setExternalFileDragging(false);
          void handlePathDrop(paths);
          return;
        }
        if (!isExternalFileDrag(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        dragDepthRef.current = 0;
        setExternalFileDragging(false);
        const paths = pathsFromDrop(event.dataTransfer);
        const files = imageFilesFromDrop(event.dataTransfer);
        void handlePathDrop(paths, files);
      }}
      onContextMenu={(event) => {
        // Windows only: replace the WebView2 native menu (whose paste is slow,
        // ~5s) with our own, backed by the same fast clipboard path as Ctrl+V.
        // macOS and Linux keep their native menus — neither has the slow-paste
        // problem, so there's no reason to override their richer native menu.
        if (!IS_WINDOWS) {
          return;
        }
        event.preventDefault();
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          hasSelection: handleRef.current?.term.hasSelection() ?? false,
        });
      }}
    >
      {externalFileDragging && <div className={dropOverlayClassName(null, true)} />}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            ...(contextMenu.hasSelection
              ? [
                  {
                    id: "copy",
                    label: t("terminalCopy"),
                    icon: Copy,
                    onSelect: () => {
                      const term = handleRef.current?.term;
                      if (term?.hasSelection()) {
                        void navigator.clipboard.writeText(term.getSelection());
                      }
                    },
                  } satisfies ContextMenuItem,
                ]
              : []),
            {
              id: "paste",
              label: t("terminalPaste"),
              icon: ClipboardPaste,
              // "cmd" so an empty clipboard is a no-op; "ctrl" would inject the
              // raw paste control byte, which a menu paste should never do.
              onSelect: () => {
                pasteRef.current?.("cmd");
                handleRef.current?.term.focus();
              },
            } satisfies ContextMenuItem,
          ]}
        />
      )}
      {actionCard && (
        <div
          className="fixed z-30"
          style={{ left: actionCard.x, top: actionCard.y + 14 }}
          onMouseEnter={cancelActionCardHide}
          onMouseLeave={() => setActionCard(null)}
        >
          <ActionCard
            actions={actionCard.actions}
            onRun={runActionCommand}
            onOpenPreview={openActionPreview}
          />
        </div>
      )}
      {searchOpen && handleRef.current && (
        <SearchBar
          search={handleRef.current.search}
          onClose={() => {
            setSearchOpen(false);
            handleRef.current?.term.focus();
          }}
        />
      )}
      {connecting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-fg-subtle">
          <Loader2 size={15} className="animate-spin" />
          <span className="text-xs">{t("terminalConnecting")}</span>
        </div>
      )}
      {outputSkipped !== null && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border border-border-strong bg-bg-elevated px-3 py-1 text-xs text-fg-muted shadow-lg">
          {t("outputThrottled", { size: formatSkipped(outputSkipped) })}
        </div>
      )}
      {sshDisconnected && !connecting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-fg-subtle">
          <WifiOff size={24} />
          <span className="text-sm">{t("ssh.disconnected")}</span>
          <button
            type="button"
            disabled={connecting}
            onClick={() => setReconnectTrigger((n) => n + 1)}
            className="rounded-md border border-border px-4 py-1.5 text-sm text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("ssh.reconnect")}
          </button>
        </div>
      )}
    </div>
  );
}
