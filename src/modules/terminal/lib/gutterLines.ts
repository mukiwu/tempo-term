/** Format a write time as zero-padded 24-hour HH:MM:SS in local time. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface VisibleStampArgs {
  /** Number of visible rows in the viewport. */
  rows: number;
  /** Absolute buffer line at the top visible row (xterm buffer.active.viewportY). */
  viewportY: number;
  /** Recorded write time for an absolute buffer line, or undefined. */
  getStamp: (line: number) => number | undefined;
  /** Whether an absolute buffer line is a wrapped continuation of the line above. */
  isWrapped: (line: number) => boolean;
}

export interface VisibleStamp {
  row: number;
  ts: number | null;
}

/**
 * Map each visible row to the timestamp the gutter should show beside it. A
 * wrapped continuation row resolves to its logical line's stamp, so every
 * visible row carries a time even mid-wrap.
 */
export function computeVisibleStamps(args: VisibleStampArgs): VisibleStamp[] {
  const out: VisibleStamp[] = [];
  for (let row = 0; row < args.rows; row += 1) {
    let line = args.viewportY + row;
    while (line > 0 && args.isWrapped(line)) {
      line -= 1;
    }
    const ts = args.getStamp(line);
    out.push({ row, ts: ts ?? null });
  }
  return out;
}
