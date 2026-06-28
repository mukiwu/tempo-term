import { describe, expect, it } from "vitest";
import { AtlasPressureGuard } from "./webglAtlasGuard";

describe("AtlasPressureGuard", () => {
  it("requests a clear once the pages-added-since-last-clear count reaches the threshold", () => {
    const guard = new AtlasPressureGuard(3, 1000, () => 0);
    expect(guard.recordPageAdded()).toBe(false); // 1
    expect(guard.recordPageAdded()).toBe(false); // 2
    expect(guard.recordPageAdded()).toBe(true); // 3 -> clear
  });

  it("counts ADDS since the last clear (clearTextureAtlas keeps pages, so removes are irrelevant)", () => {
    // A clear empties pages in place and re-rasterizes into them without firing
    // onAdd, so the right signal is genuine new growth since the last clear.
    let t = 0;
    const guard = new AtlasPressureGuard(2, 1000, () => t);
    guard.recordPageAdded();
    expect(guard.recordPageAdded()).toBe(true); // first clear, counter reset
    t = 5000; // well past the cooldown
    expect(guard.recordPageAdded()).toBe(false); // 1 of the new growth
    expect(guard.recordPageAdded()).toBe(true); // 2 -> clears again
  });

  it("does not clear again within the cooldown window, even at threshold (loop backstop)", () => {
    let t = 0;
    const guard = new AtlasPressureGuard(2, 1000, () => t);
    guard.recordPageAdded();
    expect(guard.recordPageAdded()).toBe(true); // clear at t=0
    // Pathological: the post-clear redraw immediately needs many new pages.
    t = 200; // still inside the 1000ms cooldown
    guard.recordPageAdded();
    guard.recordPageAdded();
    expect(guard.recordPageAdded()).toBe(false); // blocked by the temporal cooldown
    t = 1200; // cooldown elapsed
    expect(guard.recordPageAdded()).toBe(true); // now allowed again
  });
});
