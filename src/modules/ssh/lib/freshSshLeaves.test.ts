import { describe, expect, it } from "vitest";
import { markFreshSshLeaf, consumeFreshSshLeaf } from "./freshSshLeaves";

describe("freshSshLeaves", () => {
  it("consumeFreshSshLeaf returns true after markFreshSshLeaf", () => {
    markFreshSshLeaf("a");
    expect(consumeFreshSshLeaf("a")).toBe(true);
  });

  it("consumeFreshSshLeaf is one-shot — second call returns false", () => {
    markFreshSshLeaf("b");
    consumeFreshSshLeaf("b");
    expect(consumeFreshSshLeaf("b")).toBe(false);
  });

  it("consumeFreshSshLeaf returns false for a never-marked leaf", () => {
    expect(consumeFreshSshLeaf("never-marked")).toBe(false);
  });
});
