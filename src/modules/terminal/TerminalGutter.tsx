import { useEffect, useReducer, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import { computeVisibleStamps, formatClock } from "./lib/gutterLines";
import type { LineTimestamps } from "./lib/lineTimestamps";

interface TerminalGutterProps {
  term: Terminal;
  timestamps: LineTimestamps;
}

/**
 * Left-edge overlay showing each visible row's write time, aligned to xterm's
 * rows. Geometry is measured from the rendered `.xterm-screen` (top offset and
 * per-row height) so it tracks the real layout across font sizes and themes,
 * and it recomputes on a frame whenever the terminal renders, scrolls, resizes,
 * or new output is parsed.
 */
export function TerminalGutter({ term, timestamps }: TerminalGutterProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const frameRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const schedule = () => {
      if (frameRef.current !== null) {
        return;
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        bump();
      });
    };
    const disposers = [
      term.onRender(schedule),
      term.onScroll(schedule),
      term.onResize(schedule),
      term.onWriteParsed(schedule),
    ];
    schedule();
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      for (const d of disposers) d.dispose();
    };
  }, [term]);

  const buffer = term.buffer.active;
  const visible = computeVisibleStamps({
    rows: term.rows,
    viewportY: buffer.viewportY,
    getStamp: (line) => timestamps.get(line),
    isWrapped: (line) => buffer.getLine(line)?.isWrapped ?? false,
  });

  // Measure the live row geometry from the rendered screen so labels line up
  // with the actual rows rather than a computed guess.
  const screen = term.element?.querySelector(".xterm-screen") as HTMLElement | null;
  const root = rootRef.current;
  let topOffset = 0;
  let rowHeight = 0;
  if (screen && root) {
    const screenRect = screen.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    topOffset = screenRect.top - rootRect.top;
    rowHeight = term.rows > 0 ? screenRect.height / term.rows : 0;
  }

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-y-0 left-0 select-none font-mono text-[11px] text-fg-subtle"
    >
      {rowHeight > 0 &&
        visible.map(({ row, ts }) =>
          ts === null ? null : (
            <div
              key={row}
              className="absolute pr-2 text-right tabular-nums"
              style={{ top: topOffset + row * rowHeight, height: rowHeight, lineHeight: `${rowHeight}px` }}
            >
              {formatClock(ts)}
            </div>
          ),
        )}
    </div>
  );
}
