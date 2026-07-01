import { describe, expect, it } from "vitest";
import type { Tab } from "@/stores/tabsStore";
import type { LayoutNode } from "@/modules/terminal/lib/terminalLayout";
import { collectTabSessions } from "./tabSessions";

function tabWith(paneTree: LayoutNode, cwd?: string): Tab {
  return {
    id: "tab-1",
    spaceId: "space-1",
    title: "Tab 1",
    kind: "terminal",
    paneTree,
    activeLeafId: "L1",
    paneOrder: ["L1"],
    cwd,
  };
}

const splitTree: LayoutNode = {
  kind: "split",
  direction: "row",
  sizes: [0.5, 0.5],
  children: [
    { kind: "leaf", id: "L1", pane: { kind: "terminal", cwd: "/p" } },
    { kind: "leaf", id: "L2", pane: { kind: "terminal", cwd: "/p" } },
  ],
};

describe("collectTabSessions", () => {
  it("returns one row per terminal pane that has a live status", () => {
    const rows = collectTabSessions(
      tabWith(splitTree),
      { L1: "thinking", L2: "active" },
      { L1: "claude", L2: "codex" },
    );

    expect(rows).toEqual([
      { leafId: "L1", cwd: "/p", agent: "claude", status: "thinking" },
      { leafId: "L2", cwd: "/p", agent: "codex", status: "active" },
    ]);
  });

  it("skips panes that have no live status", () => {
    const rows = collectTabSessions(tabWith(splitTree), { L2: "active" }, {});
    expect(rows.map((r) => r.leafId)).toEqual(["L2"]);
  });

  it("ignores non-terminal panes even if a status is keyed under their id", () => {
    const tree: LayoutNode = {
      kind: "split",
      direction: "row",
      sizes: [0.5, 0.5],
      children: [
        { kind: "leaf", id: "L1", pane: { kind: "terminal", cwd: "/p" } },
        { kind: "leaf", id: "E1", pane: { kind: "editor", path: "/p/a.ts" } },
      ],
    };
    const rows = collectTabSessions(tabWith(tree), { L1: "thinking", E1: "active" }, {});
    expect(rows.map((r) => r.leafId)).toEqual(["L1"]);
  });

  it("falls back to the tab cwd when the pane has not reported one", () => {
    const tree: LayoutNode = { kind: "leaf", id: "L1", pane: { kind: "terminal" } };
    const rows = collectTabSessions(tabWith(tree, "/tab-cwd"), { L1: "idle" }, { L1: "claude" });
    expect(rows[0].cwd).toBe("/tab-cwd");
  });
});
