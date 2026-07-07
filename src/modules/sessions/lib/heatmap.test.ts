import { describe, expect, it } from "vitest";
import { heatmapMonthLabels, heatmapWeeks } from "./heatmap";
import type { HeatmapDay } from "./statsBridge";

describe("heatmapMonthLabels", () => {
  it("labels a week column with the month index only when its month first appears", () => {
    const days: HeatmapDay[] = [
      { date: "2026-05-20", messages: 1 },
      { date: "2026-06-10", messages: 2 },
      { date: "2026-07-01", messages: 3 },
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

  it("pads with null before the first date and after `end`, in a single-week grid of 7 rows", () => {
    // 2026-01-07 is a Wednesday (day 3); its week starts Sunday 2026-01-04.
    const days: HeatmapDay[] = [{ date: "2026-01-07", messages: 5 }];
    const end = new Date(2026, 0, 7);

    const weeks = heatmapWeeks(days, end);

    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toHaveLength(7);
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      { date: "2026-01-07", messages: 5 },
      null,
      null,
      null,
    ]);
  });

  it("places each date in the correct week/row and fills gaps with zero-message days", () => {
    // 2026-01-05 (Mon) and 2026-01-12 (Mon, the following week); end is the
    // later date, so the second week's Tue-Sat cells trail off into null.
    const days: HeatmapDay[] = [
      { date: "2026-01-05", messages: 2 },
      { date: "2026-01-12", messages: 7 },
    ];
    const end = new Date(2026, 0, 12);

    const weeks = heatmapWeeks(days, end);

    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toEqual([
      null,
      { date: "2026-01-05", messages: 2 },
      { date: "2026-01-06", messages: 0 },
      { date: "2026-01-07", messages: 0 },
      { date: "2026-01-08", messages: 0 },
      { date: "2026-01-09", messages: 0 },
      { date: "2026-01-10", messages: 0 },
    ]);
    expect(weeks[1]).toEqual([
      { date: "2026-01-11", messages: 0 },
      { date: "2026-01-12", messages: 7 },
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("caps the grid at 53 weeks, dropping older weeks entirely instead of exceeding the cap", () => {
    const days: HeatmapDay[] = [
      { date: "2024-04-21", messages: 1 }, // ~800 days before `end`
      { date: "2026-06-28", messages: 3 },
    ];
    const end = new Date(2026, 5, 30); // Tue 2026-06-30

    const weeks = heatmapWeeks(days, end);

    expect(weeks.length).toBeLessThanOrEqual(53);
    expect(weeks).toHaveLength(53);
    // The far-older date fell outside the capped window and isn't rendered.
    const flat = weeks.flat();
    expect(flat.find((d) => d?.date === "2024-04-21")).toBeUndefined();
    // The recent date is still present.
    expect(flat.find((d) => d?.date === "2026-06-28")).toEqual({
      date: "2026-06-28",
      messages: 3,
    });
  });

  it("every week has exactly 7 rows", () => {
    const days: HeatmapDay[] = [
      { date: "2026-01-01", messages: 1 },
      { date: "2026-02-01", messages: 1 },
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
        { date: "2026-02-05", messages: 1 },
        { date: "2026-06-10", messages: 2 },
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
