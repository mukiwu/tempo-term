import { describe, expect, it } from "vitest";
import { computeStreaks, formatHour, peakHour } from "./insights";
import type { HeatmapDay } from "./statsBridge";

const day = (date: string): HeatmapDay => ({ date, messages: 1, sessions: 1, output_tokens: 0 });

describe("computeStreaks", () => {
  it("counts the current streak back from today", () => {
    const days = [day("2026-07-05"), day("2026-07-06"), day("2026-07-07")];
    expect(computeStreaks(days, new Date(2026, 6, 7))).toEqual({ current: 3, longest: 3 });
  });

  it("keeps the current streak alive when the latest active day was yesterday", () => {
    const days = [day("2026-07-05"), day("2026-07-06")];
    // Today (07-07) has no activity yet, but yesterday did — streak stands.
    expect(computeStreaks(days, new Date(2026, 6, 7)).current).toBe(2);
  });

  it("resets the current streak when the last active day is older than yesterday", () => {
    const days = [day("2026-07-01"), day("2026-07-02")];
    expect(computeStreaks(days, new Date(2026, 6, 7)).current).toBe(0);
  });

  it("finds the longest run even when it isn't the current one", () => {
    const days = [
      day("2026-06-01"),
      day("2026-06-02"),
      day("2026-06-03"),
      day("2026-06-04"), // 4-day run
      day("2026-07-07"), // isolated, today
    ];
    expect(computeStreaks(days, new Date(2026, 6, 7))).toEqual({ current: 1, longest: 4 });
  });

  it("is zero for no activity", () => {
    expect(computeStreaks([], new Date(2026, 6, 7))).toEqual({ current: 0, longest: 0 });
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
