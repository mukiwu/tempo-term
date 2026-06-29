import type { DiffLine } from "./types";
import { useVirtualRows } from "./lib/useVirtualRows";

const LINE_STYLES: Record<DiffLine["kind"], string> = {
  add: "bg-success/10 text-success",
  del: "bg-danger/10 text-danger",
  hunk: "text-accent",
  file: "text-fg-muted",
  meta: "text-fg-subtle",
  context: "text-fg-muted",
};

// Each diff row is a fixed height so the visible window can be derived from
// scrollTop alone. The line-height utility on the rows must equal this value.
const ROW_HEIGHT = 20;
// Extra rows rendered above/below the viewport so fast scrolling never reveals
// blank space before the next render lands.
const OVERSCAN = 20;

interface DiffViewProps {
  lines: DiffLine[];
  emptyLabel: string;
}

/**
 * Renders parsed unified-diff lines with per-kind semantic colours. Only the
 * rows inside the scroll viewport (plus an overscan margin) are mounted, so a
 * multi-thousand-line diff no longer pushes thousands of DOM nodes at once.
 */
export function DiffView({ lines, emptyLabel }: DiffViewProps) {
  const { scrollRef, onScroll, start, end, offsetTop, totalHeight } =
    useVirtualRows(lines.length, ROW_HEIGHT, OVERSCAN, lines);

  if (lines.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
        {emptyLabel}
      </div>
    );
  }

  const visibleLines = lines.slice(start, end);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="h-full overflow-auto font-mono text-[12px]"
    >
      <div style={{ height: `${totalHeight}px` }} className="relative">
        <div style={{ transform: `translateY(${offsetTop}px)` }}>
          {visibleLines.map((line, i) => (
            <div
              key={start + i}
              style={{ height: `${ROW_HEIGHT}px` }}
              className={`whitespace-pre px-3 leading-5 ${LINE_STYLES[line.kind]}`}
            >
              {line.text === "" ? " " : line.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
