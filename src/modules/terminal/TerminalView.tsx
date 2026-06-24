import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, WifiOff } from "lucide-react";
import { consumeFreshSshLeaf } from "@/modules/ssh/lib/freshSshLeaves";
import { createTerminal, enableWebglRenderer, type TerminalHandle } from "./lib/createTerminal";
import { openPty, type PtySession } from "./lib/pty-bridge";
import { openSsh, type SshSession } from "@/modules/ssh/lib/ssh-bridge";
import { useForwardStatusStore } from "@/modules/ssh/lib/forwardStatusStore";
import { liveSessionsStore } from "@/modules/ssh/lib/liveSessionsStore";

/** Narrows a session to PtySession (which has cwd/foregroundCommand). */
function isPtySession(s: PtySession | SshSession): s is PtySession {
  return "cwd" in s;
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
import { buildFileLink, findFilePaths, resolveFilePath } from "./lib/fileLinks";
import { buildCellPositions, gatherLogicalLine } from "./lib/cellPositions";
import { terminalKeySequence } from "./lib/terminalKeymap";
import { shouldCdToRoot } from "./lib/cwdSync";
import { debounce } from "@/lib/debounce";
import { dropOverlayClassName } from "@/components/EntryDropOverlay";
import { fsHomeDir, fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { getDraggedEntry } from "@/modules/explorer/lib/dragEntry";
import {
  STATUS_OSC_CODE,
  isClaudeForeground,
  isCodexForeground,
  parseStatusOsc,
} from "@/modules/claude-progress/lib/sessionStatus";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";

import { IS_MAC, openModifierLabel } from "@/lib/platform";
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

interface TerminalViewProps {
  active: boolean;
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
}

export function TerminalView({
  active,
  cwdTracking = false,
  cwd,
  ssh,
  leafId,
  onExit,
  onCwdChange,
  onOpenFile,
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
  const dragDepthRef = useRef(0);
  const nativeDragPathsRef = useRef<string[]>([]);

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
    });
    handleRef.current = handle;
    const { term, fit } = handle;
    term.open(container);
    // Opt into GPU rendering now that the canvas is mounted. Falls back to the
    // DOM renderer on its own if WebGL is unavailable; term.dispose() (cleanup
    // below) tears the addon down with the terminal.
    enableWebglRenderer(term);

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
      return null;
    }

    function interceptTerminalPaste(event: KeyboardEvent): boolean {
      if (!activeRef.current || event.type !== "keydown") {
        return false;
      }
      const target = event.target;
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
      if (!activeRef.current || (target instanceof Node && !containerEl.contains(target))) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
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
        // Resolve the logical line (handles wrapped paths) and read its cells.
        const rows = gatherLogicalLine(term.buffer.active, lineNumber);
        if (!rows) {
          callback(undefined);
          return;
        }
        const { text, spans } = buildCellPositions(rows);
        const matches = findFilePaths(text);
        if (matches.length === 0) {
          callback(undefined);
          return;
        }
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
        callback(
          matches.map((m) =>
            buildFileLink({
              text: m.text,
              range: { start: startCell(m.start), end: endCell(m.end - 1) },
              hint: linkHintRef.current,
              isMac: IS_MAC,
              onOpen: (raw) => void openFromTerminal(raw),
            }),
          ),
        );
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

    // Defer the initial fit to the next animation frame so the WebGL renderer
    // has time to compute cell dimensions. FitAddon returns early (no-op) when
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
          onData: (bytes) => term.write(bytes),
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
        onData: (bytes) => term.write(bytes),
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
      cancelAnimationFrame(initialFitFrame);
      clearInterval(snapshotTimer);
      writeListener.dispose();
      observer.disconnect();
      pushPtySize.cancel();
      document.removeEventListener("keydown", onKeyDownCapture, true);
      document.removeEventListener("paste", onPasteCapture, true);
      statusOscHandler.dispose();
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
  // refit, push the new dimensions to the shell and grab focus.
  useEffect(() => {
    if (!active) {
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
  }, [active]);

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
    let last = "";
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
        if (dir !== last) {
          last = dir;
          useWorkspaceStore.getState().setRoot(dir);
        }
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
    void poll();
    const timer = setInterval(() => void poll(), 1200);
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
      clearInterval(timer);
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
    >
      {externalFileDragging && <div className={dropOverlayClassName(true)} />}
      {connecting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-fg-subtle">
          <Loader2 size={15} className="animate-spin" />
          <span className="text-xs">{t("terminalConnecting")}</span>
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
