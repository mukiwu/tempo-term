import { describe, expect, it } from "vitest";
import {
  computeLayout,
  computeSplitters,
  findPaneContent,
  firstLeafId,
  gridLayout,
  leaf,
  leafIds,
  paneIdAt,
  removeLeaf,
  resolveTerminalCwd,
  setSizesById,
  splitId,
  splitLeaf,
  type LayoutNode,
  type OrderedPane,
} from "./terminalLayout";

describe("resolveTerminalCwd", () => {
  it("prefers the pane's own saved cwd over the explorer root and tab cwd", () => {
    expect(resolveTerminalCwd("/pane/dir", "/root/dir", "/tab/dir")).toBe("/pane/dir");
  });

  it("falls back to the explorer root, then the tab cwd", () => {
    expect(resolveTerminalCwd(undefined, "/root/dir", "/tab/dir")).toBe("/root/dir");
    expect(resolveTerminalCwd(undefined, null, "/tab/dir")).toBe("/tab/dir");
  });

  it("returns undefined when nothing is set", () => {
    expect(resolveTerminalCwd(undefined, null, undefined)).toBeUndefined();
    expect(resolveTerminalCwd("", null, "")).toBeUndefined();
  });
});

describe("findPaneContent", () => {
  it("returns a leaf's content by id, or undefined when absent", () => {
    const tree = splitLeaf(leaf("a", { kind: "terminal", cwd: "/x" }), "a", "row", "b");
    expect(findPaneContent(tree, "a")).toEqual({ kind: "terminal", cwd: "/x" });
    expect(findPaneContent(tree, "missing")).toBeUndefined();
  });
});

describe("terminalLayout", () => {
  it("splits a leaf into a two-pane split", () => {
    const tree = splitLeaf(leaf("a"), "a", "row", "b");
    expect(tree.kind).toBe("split");
    expect(leafIds(tree)).toEqual(["a", "b"]);
    if (tree.kind === "split") {
      expect(tree.direction).toBe("row");
      expect(tree.sizes).toEqual([0.5, 0.5]);
    }
  });

  it("splits a nested leaf without touching siblings", () => {
    let tree: LayoutNode = splitLeaf(leaf("a"), "a", "row", "b");
    tree = splitLeaf(tree, "b", "col", "c");
    expect(leafIds(tree)).toEqual(["a", "b", "c"]);
  });

  it("removing a leaf collapses its parent onto the sibling", () => {
    let tree: LayoutNode = splitLeaf(leaf("a"), "a", "row", "b");
    const collapsed = removeLeaf(tree, "b");
    expect(collapsed).toEqual(leaf("a"));
  });

  it("removing a deeply nested leaf keeps the rest intact", () => {
    let tree: LayoutNode = splitLeaf(leaf("a"), "a", "row", "b");
    tree = splitLeaf(tree, "b", "col", "c");
    const result = removeLeaf(tree, "c");
    expect(leafIds(result!)).toEqual(["a", "b"]);
  });

  it("removing the only leaf yields null", () => {
    expect(removeLeaf(leaf("a"), "a")).toBeNull();
  });

  it("firstLeafId walks to the first leaf", () => {
    // a -> split(row,[a,b]) -> split a into col[a,c] => row[col[a,c], b]
    const tree = splitLeaf(splitLeaf(leaf("a"), "a", "row", "b"), "a", "col", "c");
    expect(firstLeafId(tree)).toBe("a");
    expect(firstLeafId(null)).toBeNull();
  });
});

describe("computeLayout", () => {
  const terminal = { kind: "terminal" } as const;

  it("gives a single leaf the full area", () => {
    expect(computeLayout(leaf("a"))).toEqual([
      { id: "a", rect: { left: 0, top: 0, width: 100, height: 100 }, content: terminal },
    ]);
  });

  it("splits a row into left and right halves", () => {
    const panes = computeLayout(splitLeaf(leaf("a"), "a", "row", "b"));
    expect(panes).toEqual([
      { id: "a", rect: { left: 0, top: 0, width: 50, height: 100 }, content: terminal },
      { id: "b", rect: { left: 50, top: 0, width: 50, height: 100 }, content: terminal },
    ]);
  });

  it("splits a col into top and bottom halves", () => {
    const panes = computeLayout(splitLeaf(leaf("a"), "a", "col", "b"));
    expect(panes).toEqual([
      { id: "a", rect: { left: 0, top: 0, width: 100, height: 50 }, content: terminal },
      { id: "b", rect: { left: 0, top: 50, width: 100, height: 50 }, content: terminal },
    ]);
  });

  it("carries each leaf's pane content for a mixed terminal + editor split", () => {
    const tree = splitLeaf(leaf("a"), "a", "row", "b", {
      kind: "editor",
      path: "/x/App.tsx",
    });
    const panes = computeLayout(tree);
    expect(panes[0].content).toEqual({ kind: "terminal" });
    expect(panes[1].content).toEqual({ kind: "editor", path: "/x/App.tsx" });
  });

  it("honours an adjusted size ratio", () => {
    const tree = setSizesById(
      splitLeaf(leaf("a"), "a", "row", "b"),
      splitId(splitLeaf(leaf("a"), "a", "row", "b")),
      [0.7, 0.3],
    );
    const panes = computeLayout(tree);
    expect(panes[0].rect.width).toBeCloseTo(70);
    expect(panes[1].rect.left).toBeCloseTo(70);
  });
});

describe("paneIdAt", () => {
  const panes = computeLayout(splitLeaf(leaf("a"), "a", "row", "b"));

  it("finds the pane covering a percentage point", () => {
    expect(paneIdAt(panes, 25, 50)).toBe("a");
    expect(paneIdAt(panes, 75, 50)).toBe("b");
  });

  it("returns null when the point falls outside every pane", () => {
    expect(paneIdAt(panes, 150, 50)).toBeNull();
    expect(paneIdAt(panes, 50, -10)).toBeNull();
  });
});

describe("computeSplitters", () => {
  it("has no splitter for a single leaf", () => {
    expect(computeSplitters(leaf("a"))).toEqual([]);
  });

  it("describes a row split's divider at its current fraction", () => {
    const tree = splitLeaf(leaf("a"), "a", "row", "b");
    const [splitter] = computeSplitters(tree);
    expect(splitter.direction).toBe("row");
    expect(splitter.fraction).toBeCloseTo(0.5);
    expect(splitter.rect).toEqual({ left: 0, top: 0, width: 100, height: 100 });
    expect(splitter.id).toBe(splitId(tree));
  });

  it("emits one splitter per split in a nested tree", () => {
    const tree = splitLeaf(splitLeaf(leaf("a"), "a", "row", "b"), "b", "col", "c");
    expect(computeSplitters(tree)).toHaveLength(2);
  });

  it("setSizesById only resizes the matching split", () => {
    const tree = splitLeaf(splitLeaf(leaf("a"), "a", "row", "b"), "b", "col", "c");
    const inner = computeSplitters(tree).find((s) => s.direction === "col")!;
    const resized = setSizesById(tree, inner.id, [0.8, 0.2]);
    const after = computeSplitters(resized);
    expect(after.find((s) => s.direction === "col")!.fraction).toBeCloseTo(0.8);
    expect(after.find((s) => s.direction === "row")!.fraction).toBeCloseTo(0.5);
  });
});

describe("git-graph pane content", () => {
  it("can hold a git-graph pane in a split", () => {
    const tree = splitLeaf(leaf("a"), "a", "row", "b", { kind: "git-graph" });
    const panes = computeLayout(tree);
    expect(panes.some((p) => p.content.kind === "git-graph")).toBe(true);
  });
});

describe("gridLayout", () => {
  function pane(id: string, path: string): OrderedPane {
    return { id, content: { kind: "editor", path } };
  }

  it("places a single pane as the whole tree", () => {
    const tree = gridLayout([pane("a", "/a.ts")]);
    expect(tree).toEqual(leaf("a", { kind: "editor", path: "/a.ts" }));
  });

  it("splits two panes into two equal-width columns, left to right in add-order", () => {
    const tree = gridLayout([pane("a", "/a.ts"), pane("b", "/b.ts")]);
    const panes = computeLayout(tree);
    const sorted = panes.slice().sort((x, y) => x.rect.left - y.rect.left);
    expect(sorted.map((p) => p.id)).toEqual(["a", "b"]);
    expect(sorted[0].rect.width).toBeCloseTo(50, 5);
    expect(sorted[1].rect.width).toBeCloseTo(50, 5);
  });

  it("splits four panes into four equal-width columns", () => {
    const tree = gridLayout(["a", "b", "c", "d"].map((id) => pane(id, `/${id}.ts`)));
    const panes = computeLayout(tree);
    const sorted = panes.slice().sort((x, y) => x.rect.left - y.rect.left);
    expect(sorted.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    for (const p of sorted) {
      expect(p.rect.width).toBeCloseTo(25, 5);
    }
  });

  it("stacks the 5th pane under the 1st column, leaving columns 2-4 single", () => {
    const tree = gridLayout(["a", "b", "c", "d", "e"].map((id) => pane(id, `/${id}.ts`)));
    const panes = computeLayout(tree);
    const columns = new Map<number, typeof panes>();
    for (const p of panes) {
      const col = Math.round(p.rect.left);
      columns.set(col, [...(columns.get(col) ?? []), p]);
    }
    // 4 distinct column positions (0, 25, 50, 75), each 25 wide.
    expect([...columns.keys()].sort((x, y) => x - y)).toEqual([0, 25, 50, 75]);
    const firstColumn = columns.get(0)!;
    expect(firstColumn).toHaveLength(2);
    const sortedFirstColumn = firstColumn.slice().sort((x, y) => x.rect.top - y.rect.top);
    expect(sortedFirstColumn.map((p) => p.id)).toEqual(["a", "e"]);
    expect(sortedFirstColumn[0].rect.height).toBeCloseTo(50, 5);
    expect(sortedFirstColumn[1].rect.height).toBeCloseTo(50, 5);
    // Columns 2-4 remain single panes at full height.
    expect(columns.get(25)).toHaveLength(1);
    expect(columns.get(50)).toHaveLength(1);
    expect(columns.get(75)).toHaveLength(1);
  });

  it("stacks the 6th, 7th, and 8th panes under columns 2, 3, and 4 respectively", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const tree = gridLayout(ids.map((id) => pane(id, `/${id}.ts`)));
    const panes = computeLayout(tree);
    expect(panes).toHaveLength(8);
    const byId = new Map(panes.map((p) => [p.id, p]));
    // Each of the 4 columns has exactly 2 panes sharing the same left edge.
    const pairs: [string, string][] = [
      ["a", "e"],
      ["b", "f"],
      ["c", "g"],
      ["d", "h"],
    ];
    for (const [topId, bottomId] of pairs) {
      const top = byId.get(topId)!;
      const bottom = byId.get(bottomId)!;
      expect(top.rect.left).toBeCloseTo(bottom.rect.left, 5);
      expect(top.rect.top).toBeLessThan(bottom.rect.top);
      expect(top.rect.height).toBeCloseTo(50, 5);
      expect(bottom.rect.height).toBeCloseTo(50, 5);
    }
  });
});
