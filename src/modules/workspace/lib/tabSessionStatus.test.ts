import { describe, expect, it } from "vitest";
import { tabSessionStatus } from "./tabSessionStatus";
import { leaf, splitLeaf } from "@/modules/terminal/lib/terminalLayout";
import type { Tab } from "@/stores/tabsStore";

function tab(partial: Partial<Tab> & Pick<Tab, "paneTree" | "activeLeafId">): Tab {
  return {
    id: "t1",
    spaceId: "s1",
    title: "x",
    kind: "terminal",
    ...partial,
  } as Tab;
}

describe("tabSessionStatus", () => {
  it("returns null when no leaf has a status", () => {
    const t = tab({ paneTree: leaf("p1"), activeLeafId: "p1" });
    expect(tabSessionStatus(t, {})).toBeNull();
  });

  it("returns the single terminal leaf's status", () => {
    const t = tab({ paneTree: leaf("p1"), activeLeafId: "p1" });
    expect(tabSessionStatus(t, { p1: "active" })).toBe("active");
  });

  it("prefers waiting-approval over active across leaves", () => {
    const tree = splitLeaf(leaf("p1"), "p1", "row", "p2");
    const t = tab({ paneTree: tree, activeLeafId: "p1" });
    expect(tabSessionStatus(t, { p1: "active", p2: "waiting-approval" })).toBe("waiting-approval");
  });

  it("ignores statuses keyed to non-terminal panes", () => {
    const tree = splitLeaf(leaf("p1", { kind: "editor", path: "/x" }), "p1", "row", "p2");
    const t = tab({ paneTree: tree, activeLeafId: "p2" });
    expect(tabSessionStatus(t, { p1: "active", p2: "idle" })).toBe("idle");
  });
});
