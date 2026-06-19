import { describe, expect, it } from "vitest";
import {
  computeLayout,
  computeSplitters,
  findPaneContent,
  firstLeafId,
  leaf,
  leafIds,
  paneIdAt,
  removeLeaf,
  resolveTerminalCwd,
  setSizesById,
  splitId,
  splitLeaf,
  type LayoutNode,
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
