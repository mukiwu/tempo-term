import { describe, expect, it } from "vitest";
import { heatmapWeeks } from "./heatmap";
import type { HeatmapDay } from "./statsBridge";

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
});
