export interface LineTimestamps {
  /** Record `ts` for each line in [fromLine, toLine] that has no timestamp yet. */
  stamp(fromLine: number, toLine: number, ts: number): void;
  /** The recorded write time for a buffer line, or undefined if unstamped. */
  get(line: number): number | undefined;
  /** Number of stamped lines currently held. */
  readonly size: number;
}

/** Default cap on stamped lines, a little above the terminal's scrollback. */
const DEFAULT_MAX = 12_000;

/**
 * Records the time each terminal buffer line was first written, so a gutter can
 * show per-line timestamps. First write wins; the oldest entries are pruned
 * once the cap is exceeded so the map can't grow without bound.
 */
export function createLineTimestamps(options: { max?: number } = {}): LineTimestamps {
  const max = options.max ?? DEFAULT_MAX;
  const times = new Map<number, number>();

  return {
    stamp(fromLine, toLine, ts) {
      for (let line = fromLine; line <= toLine; line += 1) {
        if (!times.has(line)) {
          times.set(line, ts);
        }
      }
      while (times.size > max) {
        const oldest = times.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        times.delete(oldest);
      }
    },
    get(line) {
      return times.get(line);
    },
    get size() {
      return times.size;
    },
  };
}
