import { describe, expect, it, vi } from "vitest";
import { changeAtViewportTop } from "./changeAtTop";

/** Ten changes, 100px apart, the first at y=0. */
const tops = Array.from({ length: 10 }, (_, i) => i * 100);
const topOf = (i: number) => tops[i] ?? null;

describe("changeAtViewportTop", () => {
  it("reports the last change at or above the viewport top", () => {
    expect(changeAtViewportTop(10, 0, topOf)).toBe(1);
    expect(changeAtViewportTop(10, 250, topOf)).toBe(3);
    expect(changeAtViewportTop(10, 300, topOf)).toBe(4);
    expect(changeAtViewportTop(10, 5000, topOf)).toBe(10);
  });

  it("reports nothing while the page is above the first change", () => {
    expect(changeAtViewportTop(10, -1, topOf)).toBe(0);
    expect(changeAtViewportTop(0, 500, topOf)).toBe(0);
  });

  it("reads a handful of positions, not one per change", () => {
    const probe = vi.fn(topOf);
    changeAtViewportTop(1000, 500_000, (i) => probe(i));
    // Binary search over 1000: ten probes, not a thousand.
    expect(probe.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("treats a change whose position is unknown as below the viewport", () => {
    // A file near the end of the page whose editors are not up yet: the
    // counter lags rather than running ahead of what is on screen.
    const partial = (i: number) => (i < 5 ? tops[i] : null);
    expect(changeAtViewportTop(10, 5000, partial)).toBe(5);
  });
});
