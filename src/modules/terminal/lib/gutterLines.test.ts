import { describe, expect, it } from "vitest";
import { computeVisibleStamps, formatClock } from "./gutterLines";

describe("formatClock", () => {
  it("formats a timestamp as zero-padded 24h HH:MM:SS in local time", () => {
    const ts = new Date(2020, 0, 1, 9, 5, 3).getTime();
    expect(formatClock(ts)).toBe("09:05:03");
  });
});

describe("computeVisibleStamps", () => {
  it("resolves each visible row to its buffer line's timestamp, null when unstamped", () => {
    const stamps = new Map([
      [0, 1000],
      [1, 2000],
    ]);
    const rows = computeVisibleStamps({
      rows: 3,
      viewportY: 0,
      getStamp: (line) => stamps.get(line),
      isWrapped: () => false,
    });

    expect(rows).toEqual([
      { row: 0, ts: 1000 },
      { row: 1, ts: 2000 },
      { row: 2, ts: null },
    ]);
  });

  it("resolves a wrapped continuation row to its logical line's timestamp", () => {
    const stamps = new Map([[0, 1000]]);
    const rows = computeVisibleStamps({
      rows: 2,
      viewportY: 0,
      getStamp: (line) => stamps.get(line),
      isWrapped: (line) => line === 1, // line 1 wraps from line 0
    });

    expect(rows).toEqual([
      { row: 0, ts: 1000 },
      { row: 1, ts: 1000 },
    ]);
  });
});
