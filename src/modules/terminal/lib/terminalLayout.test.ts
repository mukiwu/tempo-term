import { describe, expect, it } from "vitest";
import {
  computeLayout,
  firstLeafId,
  leaf,
  leafIds,
  removeLeaf,
  splitLeaf,
  type LayoutNode,
} from "./terminalLayout";

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
  it("gives a single leaf the full area", () => {
    expect(computeLayout(leaf("a"))).toEqual([
      { id: "a", rect: { left: 0, top: 0, width: 100, height: 100 } },
    ]);
  });

  it("splits a row into left and right halves", () => {
    const panes = computeLayout(splitLeaf(leaf("a"), "a", "row", "b"));
    expect(panes).toEqual([
      { id: "a", rect: { left: 0, top: 0, width: 50, height: 100 } },
      { id: "b", rect: { left: 50, top: 0, width: 50, height: 100 } },
    ]);
  });

  it("splits a col into top and bottom halves", () => {
    const panes = computeLayout(splitLeaf(leaf("a"), "a", "col", "b"));
    expect(panes).toEqual([
      { id: "a", rect: { left: 0, top: 0, width: 100, height: 50 } },
      { id: "b", rect: { left: 0, top: 50, width: 100, height: 50 } },
    ]);
  });
});
