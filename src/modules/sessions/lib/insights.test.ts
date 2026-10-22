import { describe, expect, it } from "vitest";
import { dailyUsage, formatHour, modelSlices, OTHERS_SLICE, peakHour, sessionsActiveOn } from "./insights";
import type { DailyModelTokens, ModelTokens } from "./statsBridge";
import type { SessionSummary } from "./sessionsBridge";

describe("modelSlices", () => {
  const m = (model: string, output_tokens: number): ModelTokens => ({
    model,
    output_tokens,
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  });

  it("sorts by tokens desc and computes percentage shares", () => {
    const slices = modelSlices([m("a", 100), m("b", 300)], 6);
    expect(slices.map((s) => s.label)).toEqual(["b", "a"]);
    expect(slices[0].pct).toBe(75);
    expect(slices[1].pct).toBe(25);
  });

  it("folds everything past maxSlices into an others bucket", () => {
    const slices = modelSlices(
      [m("a", 50), m("b", 40), m("c", 30), m("d", 20), m("e", 10)],
      3,
    );
    // top 3 (a,b,c) + others (d+e = 30)
    expect(slices.map((s) => s.label)).toEqual(["a", "b", "c", OTHERS_SLICE]);
    expect(slices[3].tokens).toBe(30);
  });

  it("drops zero-token models and returns nothing when the total is zero", () => {
    expect(modelSlices([m("a", 0), m("b", 0)], 6)).toEqual([]);
    const slices = modelSlices([m("a", 10), m("b", 0)], 6);
    expect(slices).toHaveLength(1);
    expect(slices[0].label).toBe("a");
  });
});

describe("peakHour / formatHour", () => {
  it("returns the busiest hour index, or null with no activity", () => {
    const hourly = new Array(24).fill(0);
    hourly[14] = 50;
    hourly[9] = 30;
    expect(peakHour(hourly)).toBe(14);
    expect(peakHour(new Array(24).fill(0))).toBeNull();
  });

  it("formats hours on a 12-hour clock", () => {
    expect(formatHour(0)).toBe("12 AM");
    expect(formatHour(9)).toBe("9 AM");
    expect(formatHour(12)).toBe("12 PM");
    expect(formatHour(23)).toBe("11 PM");
  });
});

describe("dailyUsage", () => {
  const row = (date: string, model: string, output_tokens: number, input_tokens = 0): DailyModelTokens => ({
    date,
    model,
    output_tokens,
    input_tokens,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  });

  it("returns seven days ending on `end`, zero-filling quiet days", () => {
    const days = dailyUsage([row("2026-10-21", "claude-sonnet-5", 1_000_000)], new Date(2026, 9, 22));
    expect(days.map((d) => d.date)).toEqual([
      "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22",
    ]);
    expect(days[5].output).toBe(1_000_000);
    expect(days[5].usd).toBe(15);
    expect(days[6].total).toBe(0);
  });

  it("sums every model of a day and flags unpriced models", () => {
    const days = dailyUsage(
      [row("2026-10-22", "claude-sonnet-5", 10, 5), row("2026-10-22", "", 20)],
      new Date(2026, 9, 22),
    );
    expect(days[6].total).toBe(35);
    expect(days[6].unpriced).toBe(true);
  });
});

describe("sessionsActiveOn", () => {
  const session = (id: string, start: Date, end: Date) =>
    ({ id, started_at: start.getTime(), ended_at: end.getTime() }) as SessionSummary;

  it("keeps sessions overlapping the day, newest first", () => {
    const result = sessionsActiveOn(
      [
        session("before", new Date(2026, 9, 20, 9), new Date(2026, 9, 20, 10)),
        session("spans", new Date(2026, 9, 20, 23), new Date(2026, 9, 21, 1)),
        session("inside", new Date(2026, 9, 21, 12), new Date(2026, 9, 21, 13)),
        session("after", new Date(2026, 9, 22, 0), new Date(2026, 9, 22, 1)),
      ],
      "2026-10-21",
    );
    expect(result.map((s) => s.id)).toEqual(["inside", "spans"]);
  });
});
