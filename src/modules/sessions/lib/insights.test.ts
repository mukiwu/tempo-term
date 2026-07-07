import { describe, expect, it } from "vitest";
import { formatHour, modelSlices, OTHERS_SLICE, peakHour } from "./insights";
import type { ModelTokens } from "./statsBridge";

describe("modelSlices", () => {
  const m = (model: string, output_tokens: number): ModelTokens => ({ model, output_tokens });

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
