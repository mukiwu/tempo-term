import { describe, expect, it } from "vitest";
import { nearestTabInsertion, type TabBarSlot } from "./tabBarDrop";

describe("nearestTabInsertion", () => {
  const tabs: TabBarSlot[] = [
    { id: "a", left: 0, width: 100 },
    { id: "b", left: 100, width: 100 },
    { id: "c", left: 200, width: 100 },
  ];

  it("returns the first tab's id when the pointer is left of its midpoint", () => {
    expect(nearestTabInsertion(tabs, 10)).toBe("a");
  });

  it("returns the next tab's id when the pointer is past the first tab's midpoint but before the second's", () => {
    expect(nearestTabInsertion(tabs, 120)).toBe("b");
  });

  it("returns null when the pointer is past every tab's midpoint (insert at the very end)", () => {
    expect(nearestTabInsertion(tabs, 280)).toBeNull();
  });

  it("returns null when there are no tabs at all", () => {
    expect(nearestTabInsertion([], 50)).toBeNull();
  });

  it("resolves a boundary exactly at a midpoint to the next tab (strict less-than, so the midpoint itself is already 'past')", () => {
    expect(nearestTabInsertion(tabs, 50)).toBe("b");
    expect(nearestTabInsertion(tabs, 150)).toBe("c");
  });
});
