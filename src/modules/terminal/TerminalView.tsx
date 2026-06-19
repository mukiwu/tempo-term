import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { createTerminal, type TerminalHandle } from "./lib/createTerminal";
import { openPty, type PtySession } from "./lib/pty-bridge";
import {
  deleteTerminalHistory,
  loadTerminalHistory,
  saveTerminalHistory,
  serializeBufferText,
  trimScrollback,
  MAX_SCROLLBACK_LINES,
} from "./lib/terminalHistory";
import {
  registerTerminal,
  registerTerminalPathDrop,
  unregisterTerminal,
  unregisterTerminalPathDrop,
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
import { findFilePaths, resolveFilePath } from "./lib/fileLinks";
import { terminalKeySequence } from "./lib/terminalKeymap";
import { shouldCdToRoot } from "./lib/cwdSync";
import { dropOverlayClassName } from "@/components/EntryDropOverlay";
import { fsHomeDir, fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { getDraggedEntry } from "@/modules/explorer/lib/dragEntry";

const IS_MAC =
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
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
  const sessionRef = useRef<PtySession | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;
  const { t } = useTranslation();
  const linkHintRef = useRef(t("openLinkHint"));
  linkHintRef.current = t("openLinkHint");

  const fontFamily = useFontStore(selectTerminalFontFamily);
  const fontSize = useFontStore((s) => s.fontSize);
  const themeId = useSettingsStore((s) => s.themeId);
  const terminalPadding = useSettingsStore((s) => s.terminalPadding);
  const [connecting, setConnecting] = useState(true);
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
          command = await session.foregroundCommand().catch(() => null);
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
        const live = await sessionRef.current?.cwd();
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
        const firstLine = buffer.getLine(lineNumber - 1);
        // Only handle a logical line at its first row; wrapped continuation rows
        // are covered by the multi-row range built below.
        if (!firstLine || firstLine.isWrapped) {
          callback(undefined);
          return;
        }
        // Gather the logical line: this row plus any wrapped continuation rows,
        // so a path that wraps across rows is still detected as one link.
        const rows: { y: number; text: string }[] = [];
        let y = lineNumber;
        let line: typeof firstLine | undefined = firstLine;
        while (line) {
          rows.push({ y, text: line.translateToString(false) });
          const next = buffer.getLine(y);
          if (!next || !next.isWrapped) {
            break;
          }
          line = next;
          y += 1;
        }
        const matches = findFilePaths(rows.map((r) => r.text).join(""));
        if (matches.length === 0) {
          callback(undefined);
          return;
        }
        // Map an index in the joined text back to a buffer cell (1-based x/y).
        const locate = (index: number): { x: number; y: number } => {
          let acc = 0;
          for (const row of rows) {
            if (index < acc + row.text.length) {
              return { x: index - acc + 1, y: row.y };
            }
            acc += row.text.length;
          }
          const last = rows[rows.length - 1];
          return { x: last.text.length, y: last.y };
        };
        callback(
          matches.map((m) => ({
            range: { start: locate(m.start), end: locate(m.end - 1) },
            text: m.text,
            activate: (event: MouseEvent) => {
              // Alt+click is xterm's rectangular-select gesture and can be
              // swallowed, so Cmd+click works too (matching VS Code's gesture).
              if (event.altKey || event.metaKey) {
                void openFromTerminal(m.text);
              }
            },
          })),
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

    safeFit();

    let disposed = false;

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
      // and convert "\n" to "\r\n" for the terminal.
      term.write(`\x1b[90m${saved.replace(/\n/g, "\r\n")}\x1b[0m\r\n`);
      term.write("\x1b[90m── previous session ──\x1b[0m\r\n");
    };

    void restoreHistory().then(() => {
      if (disposed) {
        return;
      }
      void openPty({
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
    })
      .then((session) => {
        if (disposed) {
          void session.close();
          return;
        }
        sessionRef.current = session;
        term.onData((data) => void session.write(data));
        if (leafIdRef.current) {
          registerTerminal(leafIdRef.current, (text) => void session.write(text));
          registerTerminalPathDrop(leafIdRef.current, (paths) => handlePathDrop(paths));
        }
        // A freshly opened tracking pane drives the explorer to its start dir
        // right away instead of waiting for the next cwd poll. (Lets "open in
        // terminal" sync the explorer via the NEW pane, leaving others untouched.)
        if (cwdTracking && cwdRef.current) {
          useWorkspaceStore.getState().setRoot(cwdRef.current);
        }
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
      const data = trimScrollback(
        serializeBufferText(term, MAX_SCROLLBACK_LINES),
        MAX_SCROLLBACK_LINES,
      );
      void saveTerminalHistory(leafId, data).catch(() => {
        dirty = true;
      });
    };
    const snapshotTimer = setInterval(snapshot, 5000);

    const observer = new ResizeObserver(() => {
      safeFit();
      const session = sessionRef.current;
      if (session) {
        void session.resize(term.cols, term.rows);
      }
    });
    observer.observe(container);

    return () => {
      disposed = true;
      clearInterval(snapshotTimer);
      writeListener.dispose();
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDownCapture, true);
      document.removeEventListener("paste", onPasteCapture, true);
      if (leafIdRef.current) {
        unregisterTerminal(leafIdRef.current);
        unregisterTerminalPathDrop(leafIdRef.current);
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
  // the file explorer tracks `cd`.
  useEffect(() => {
    if (!cwdTracking) {
      return;
    }
    let cancelled = false;
    let last = "";
    const poll = async () => {
      const session = sessionRef.current;
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
  // its last directory is saved between polls. Event-driven, no extra polling.
  useEffect(() => {
    if (active) {
      return;
    }
    const session = sessionRef.current;
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
    const command = await session.foregroundCommand().catch(() => null);
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
    </div>
  );
}
