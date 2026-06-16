import { useEffect, useRef } from "react";
import { WebglAddon } from "@xterm/addon-webgl";
import { createTerminal, type TerminalHandle } from "./lib/createTerminal";
import { openPty, type PtySession } from "./lib/pty-bridge";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";

interface TerminalViewProps {
  active: boolean;
  onExit?: () => void;
}

export function TerminalView({ active, onExit }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  const sessionRef = useRef<PtySession | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const fontFamily = useFontStore(selectTerminalFontFamily);
  const fontSize = useFontStore((s) => s.fontSize);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const initial = useFontStore.getState();
    const handle = createTerminal({
      fontFamily: selectTerminalFontFamily(initial),
      fontSize: initial.fontSize,
    });
    handleRef.current = handle;
    const { term, fit } = handle;
    term.open(container);

    // GPU renderer for throughput; xterm falls back to canvas/DOM on failure.
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // ignore, fallback renderer is automatic
    }

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
      onData: (bytes) => term.write(bytes),
      onExit: () => onExitRef.current?.(),
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

  return <div ref={containerRef} className="h-full w-full" />;
}
