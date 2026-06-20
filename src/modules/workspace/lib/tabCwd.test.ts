import { describe, expect, it } from "vitest";
import { deriveTabCwd } from "./tabCwd";
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

describe("deriveTabCwd", () => {
  it("uses the active terminal pane cwd when present", () => {
    const t = tab({ paneTree: leaf("p1", { kind: "terminal", cwd: "/a" }), activeLeafId: "p1" });
    expect(deriveTabCwd(t)).toBe("/a");
  });

  it("falls back to tab.cwd when the active pane has none", () => {
    const t = tab({ paneTree: leaf("p1", { kind: "terminal" }), activeLeafId: "p1", cwd: "/b" });
    expect(deriveTabCwd(t)).toBe("/b");
  });

  it("falls back to the first terminal pane cwd in the tree", () => {
    const tree = splitLeaf(leaf("p1", { kind: "editor", path: "/x" }), "p1", "row", "p2", {
      kind: "terminal",
      cwd: "/c",
    });
    const t = tab({ paneTree: tree, activeLeafId: "p1" });
    expect(deriveTabCwd(t)).toBe("/c");
  });

  it("returns null when no terminal cwd exists anywhere", () => {
    const t = tab({ paneTree: leaf("p1", { kind: "editor", path: "/x" }), activeLeafId: "p1" });
    expect(deriveTabCwd(t)).toBeNull();
  });
});
