import { describe, expect, it } from "vitest";
import { heatmapLevel, heatmapMax, heatmapMonthLabels, heatmapWeeks } from "./heatmap";
import type { HeatmapDay } from "./statsBridge";

const day = (date: string, over: Partial<HeatmapDay> = {}): HeatmapDay => ({
  date,
  messages: 0,
  sessions: 0,
  output_tokens: 0,
  ...over,
});

describe("heatmapMax / heatmapLevel", () => {
  it("scales intensity to the max of the chosen metric", () => {
    const days = [
      day("2026-07-01", { messages: 2, output_tokens: 5000 }),
      day("2026-07-02", { messages: 40, output_tokens: 100 }),
    ];
    expect(heatmapMax(days, "messages")).toBe(40);
    expect(heatmapMax(days, "output_tokens")).toBe(5000);
    // Same day is top intensity by tokens but low by messages.
    expect(heatmapLevel(days[0].output_tokens, 5000)).toBe(4);
    expect(heatmapLevel(days[0].messages, 40)).toBe(1);
  });

  it("returns 0 for no activity and clamps to the 1..4 range", () => {
    expect(heatmapLevel(0, 100)).toBe(0);
    expect(heatmapLevel(5, 0)).toBe(0); // empty range
    expect(heatmapLevel(1, 100)).toBe(1);
    expect(heatmapLevel(100, 100)).toBe(4);
  });

  it("heatmapMax is 0 for an empty set", () => {
    expect(heatmapMax([], "messages")).toBe(0);
  });
});

describe("heatmapMonthLabels", () => {
  it("labels a week column with the month index only when its month first appears", () => {
    const days: HeatmapDay[] = [
      day("2026-05-20", { messages: 1 }),
      day("2026-06-10", { messages: 2 }),
      day("2026-07-01", { messages: 3 }),
    ];
    const weeks = heatmapWeeks(days, new Date(2026, 6, 6));
    const labels = heatmapMonthLabels(weeks);

    // Same length as the grid, one entry per week column.
    expect(labels).toHaveLength(weeks.length);
    // The distinct month indices appear in calendar order (May=4, Jun=5, Jul=6),
    // each once, at the column where that month starts.
    const shown = labels.filter((m): m is number => m !== null);
    expect(shown).toEqual([4, 5, 6]);
  });

  it("returns an empty array for an empty grid", () => {
    expect(heatmapMonthLabels([])).toEqual([]);
  });
});

describe("heatmapWeeks", () => {
  it("returns no columns for empty input", () => {
    expect(heatmapWeeks([], new Date(2026, 0, 7))).toEqual([]);
  });

  it("spans the whole window from an explicit start, with empty leading days", () => {
    // The window opens 30 days before `end`, but the only active day is near
    // the end: the grid must reach back to the start (empty tiles), not begin
    // at the first active day — the "fixed range = full calendar" behavior.
    const end = new Date(2026, 6, 15); // 2026-07-15
    const rangeStart = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 30);
    const days: HeatmapDay[] = [day("2026-07-10", { messages: 4 })];

    const weeks = heatmapWeeks(days, end, rangeStart);
    const flat = weeks.flat().filter((c): c is HeatmapDay => c !== null);
    // A cell earlier than the only data day is present (the empty lead-in).
    expect(flat.some((c) => c.date < "2026-07-10")).toBe(true);
    expect(flat.find((c) => c.date === "2026-07-10")?.messages).toBe(4);
    // Those pre-data days are zero-filled, not absent.
    const earlier = flat.filter((c) => c.date < "2026-07-10");
    expect(earlier.every((c) => c.messages === 0)).toBe(true);
  });

  it("renders a full empty grid when there are no days but a start is given", () => {
    const end = new Date(2026, 6, 15);
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 13); // 2 weeks
    const weeks = heatmapWeeks([], end, start);
    // Not the early-return-[] path: a real grid with zero-filled in-window cells.
    expect(weeks.length).toBeGreaterThan(0);
    const inWindow = weeks.flat().filter((c): c is HeatmapDay => c !== null);
    expect(inWindow.length).toBeGreaterThan(0);
    expect(inWindow.every((c) => c.messages === 0)).toBe(true);
  });

  it("pads with null before the first date and after `end`, in a single-week grid of 7 rows", () => {
    // 2026-01-07 is a Wednesday (day 3); its week starts Sunday 2026-01-04.
    const days: HeatmapDay[] = [day("2026-01-07", { messages: 5 })];
    const end = new Date(2026, 0, 7);

    const weeks = heatmapWeeks(days, end);

    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toHaveLength(7);
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      day("2026-01-07", { messages: 5 }),
      null,
      null,
      null,
    ]);
  });

  it("places each date in the correct week/row and fills gaps with zero-message days", () => {
    // 2026-01-05 (Mon) and 2026-01-12 (Mon, the following week); end is the
    // later date, so the second week's Tue-Sat cells trail off into null.
    const days: HeatmapDay[] = [
      day("2026-01-05", { messages: 2 }),
      day("2026-01-12", { messages: 7 }),
    ];
    const end = new Date(2026, 0, 12);

    const weeks = heatmapWeeks(days, end);

    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toEqual([
      null,
      day("2026-01-05", { messages: 2 }),
      day("2026-01-06", { messages: 0 }),
      day("2026-01-07", { messages: 0 }),
      day("2026-01-08", { messages: 0 }),
      day("2026-01-09", { messages: 0 }),
      day("2026-01-10", { messages: 0 }),
    ]);
    expect(weeks[1]).toEqual([
      day("2026-01-11", { messages: 0 }),
      day("2026-01-12", { messages: 7 }),
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("caps the grid at 53 weeks, dropping older weeks entirely instead of exceeding the cap", () => {
    const days: HeatmapDay[] = [
      day("2024-04-21", { messages: 1 }), // ~800 days before `end`
      day("2026-06-28", { messages: 3 }),
    ];
    const end = new Date(2026, 5, 30); // Tue 2026-06-30

    const weeks = heatmapWeeks(days, end);

    expect(weeks.length).toBeLessThanOrEqual(53);
    expect(weeks).toHaveLength(53);
    // The far-older date fell outside the capped window and isn't rendered.
    const flat = weeks.flat();
    expect(flat.find((d) => d?.date === "2024-04-21")).toBeUndefined();
    // The recent date is still present.
    expect(flat.find((d) => d?.date === "2026-06-28")).toEqual(day("2026-06-28", { messages: 3 }));
  });

  it("every week has exactly 7 rows", () => {
    const days: HeatmapDay[] = [
      day("2026-01-01", { messages: 1 }),
      day("2026-02-01", { messages: 1 }),
    ];
    const weeks = heatmapWeeks(days, new Date(2026, 1, 1));

    for (const week of weeks) {
      expect(week).toHaveLength(7);
    }
  });

  it("keeps date labels continuous across a DST transition", () => {
    // Node honors runtime TZ changes on POSIX (assigning process.env.TZ
    // invalidates V8's date cache), so pin a DST timezone for this test.
    // With `end` in EDT (summer) and the grid reaching back across the US
    // spring-forward (2026-03-08) into EST, raw ms stepping would put the
    // grid start at 23:00 the previous day — labeling the whole
    // pre-transition tail one day early and skipping 2026-03-08 entirely.
    // Calendar-safe stepping must keep every label on its real date. The
    // autumn fall-back direction is the same class of bug with the offsets
    // reversed, covered by the same calendar-safe construction.
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const days: HeatmapDay[] = [
        day("2026-02-05", { messages: 1 }),
        day("2026-06-10", { messages: 2 }),
      ];
      const weeks = heatmapWeeks(days, new Date(2026, 5, 15));

      const labels = weeks.flat().flatMap((d) => (d ? [d.date] : []));
      expect(labels[0]).toBe("2026-02-05");
      // Every consecutive cell must differ by exactly one calendar day. The
      // expected key is computed calendar-safe here too, so the expectation
      // itself can't inherit the bug it's guarding against.
      for (let i = 1; i < labels.length; i++) {
        const [y, m, d] = labels[i - 1].split("-").map(Number);
        const next = new Date(y, m - 1, d + 1);
        const nextKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(
          next.getDate(),
        ).padStart(2, "0")}`;
        expect(labels[i]).toBe(nextKey);
      }
      // The transition day and its neighbors are each present exactly once.
      expect(labels.filter((l) => l === "2026-03-07")).toHaveLength(1);
      expect(labels.filter((l) => l === "2026-03-08")).toHaveLength(1);
      expect(labels.filter((l) => l === "2026-03-09")).toHaveLength(1);
    } finally {
      process.env.TZ = originalTz;
    }
  });
});
