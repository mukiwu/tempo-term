import { useEffect, useRef } from "react";
import { createTerminal, type TerminalHandle } from "./lib/createTerminal";
import { openPty, type PtySession } from "./lib/pty-bridge";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { getTheme } from "@/themes/themes";

interface TerminalViewProps {
  active: boolean;
  /** When true, this pane drives the file explorer root from its shell CWD. */
  cwdTracking?: boolean;
  /** Directory the shell starts in. */
  cwd?: string;
  onExit?: () => void;
}

export function TerminalView({ active, cwdTracking = false, cwd, onExit }: TerminalViewProps) {
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  const sessionRef = useRef<PtySession | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const fontFamily = useFontStore(selectTerminalFontFamily);
  const fontSize = useFontStore((s) => s.fontSize);
  const themeId = useSettingsStore((s) => s.themeId);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const initial = useFontStore.getState();
    const handle = createTerminal({
      fontFamily: selectTerminalFontFamily(initial),
      fontSize: initial.fontSize,
      theme: getTheme(useSettingsStore.getState().themeId).terminal,
    });
    handleRef.current = handle;
    const { term, fit } = handle;
    term.open(container);

    // Drop keydown events that belong to an active IME composition so the
    // composed text is only delivered once, through xterm's compositionend
    // path. Chromium reports keyCode 229 for keys pressed during composition,
    // and modern browsers set isComposing. Without this, switching the input
    // method mid-composition sends the text to the PTY twice.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && (event.isComposing || event.keyCode === 229)) {
        return false;
      }
      return true;
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
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        term.write(`\r\n\x1b[31mFailed to open shell: ${message}\x1b[0m\r\n`);
      });

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
      observer.disconnect();
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
        if (!cancelled && dir && dir !== last) {
          last = dir;
          useWorkspaceStore.getState().setRoot(dir);
        }
      } catch {
        // ignore transient failures
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1200);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cwdTracking]);

  return <div ref={containerRef} className="h-full w-full" />;
}
