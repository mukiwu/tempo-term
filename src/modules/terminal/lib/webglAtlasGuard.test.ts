import { describe, expect, it } from "vitest";
import { AtlasPressureGuard } from "./webglAtlasGuard";

describe("AtlasPressureGuard", () => {
  it("requests a clear only once the page count reaches the threshold", () => {
    const guard = new AtlasPressureGuard(3);
    expect(guard.recordAdd()).toBe(false); // 1
    expect(guard.recordAdd()).toBe(false); // 2
    expect(guard.recordAdd()).toBe(true); // 3 -> at threshold, clear
  });

  it("does not request another clear while cooling down (avoids a clear loop)", () => {
    const guard = new AtlasPressureGuard(2);
    expect(guard.recordAdd()).toBe(false); // 1
    expect(guard.recordAdd()).toBe(true); // 2 -> clear requested, now cooling
    // The clear's redraw re-adds a few visible-glyph pages; these must NOT
    // trigger another clear until reset() runs.
    expect(guard.recordAdd()).toBe(false);
    expect(guard.recordAdd()).toBe(false);
  });

  it("can trigger again after reset() once pressure rebuilds", () => {
    const guard = new AtlasPressureGuard(2);
    guard.recordAdd();
    expect(guard.recordAdd()).toBe(true); // first clear
    guard.reset();
    expect(guard.recordAdd()).toBe(false); // 1 after reset
    expect(guard.recordAdd()).toBe(true); // 2 -> clears again
  });

  it("decrements on page removal, floored at zero, so merges delay the next clear", () => {
    const guard = new AtlasPressureGuard(3);
    guard.recordAdd(); // 1
    guard.recordAdd(); // 2
    guard.recordRemove(); // 1 (a merge removed a page)
    guard.recordRemove(); // 0
    guard.recordRemove(); // stays 0, never negative
    expect(guard.recordAdd()).toBe(false); // 1
    expect(guard.recordAdd()).toBe(false); // 2
    expect(guard.recordAdd()).toBe(true); // 3 -> threshold
  });
});
