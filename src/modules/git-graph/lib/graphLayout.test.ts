import { describe, expect, it } from "vitest";
import {
  computeGraphLayout,
  DEFAULT_GEOMETRY,
  edgePath,
  firstParentRowIndex,
  laneContinuationRowIndex,
  laneSizing,
  laneX,
  type GraphEdge,
  type GraphGeometry,
} from "./graphLayout";
import type { CommitNode } from "../types";

function commit(
  hash: string,
  parents: string[],
  overrides: Partial<CommitNode> = {},
): CommitNode {
  return {
    hash,
    parents,
    author: "Test",
    date: "2024-01-01 00:00",
    message: hash,
    refs: [],
    ...overrides,
  };
}

/** A geometry that still collapses wide lanes — the sidebar's inline history. */
const COLLAPSING: GraphGeometry = { ...DEFAULT_GEOMETRY, laneWidthMin: undefined };

describe("computeGraphLayout", () => {
  it("keeps a linear history in a single lane", () => {
    const commits = [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];
    const { layouts, edges } = computeGraphLayout(commits);

    expect(layouts["c"].lane).toBe(0);
    expect(layouts["b"].lane).toBe(0);
    expect(layouts["a"].lane).toBe(0);
    // Rows advance by index; the root commit is last.
    expect(layouts["a"].index).toBe(2);
    // Two parent links, both straight within lane 0.
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.cx === e.px)).toBe(true);
  });

  it("gives a merge commit's second parent its own lane and reuses it after", () => {
    // m merges a (lane 0) and b; b then merges back to a's history.
    const commits = [
      commit("m", ["a", "b"]),
      commit("b", ["a"]),
      commit("a", []),
    ];
    const { layouts } = computeGraphLayout(commits);

    expect(layouts["m"].lane).toBe(0);
    // The extra merge parent b claims a fresh lane.
    expect(layouts["b"].lane).toBe(1);
    // a is still on lane 0 (m's first parent followed the lane).
    expect(layouts["a"].lane).toBe(0);
  });

  it("frees a lane once its waited-for commit is reached so later branches reuse it", () => {
    // Two independent tips that both end at the same root, then a new root.
    const commits = [
      commit("x", ["root"]),
      commit("y", ["root"]),
      commit("root", []),
      commit("z", []),
    ];
    const { layouts } = computeGraphLayout(commits);

    expect(layouts["x"].lane).toBe(0);
    expect(layouts["y"].lane).toBe(1);
    expect(layouts["root"].lane).toBe(0);
    // After root frees both lanes, z reuses the lowest free lane.
    expect(layouts["z"].lane).toBe(0);
  });

  it("resolves parents referenced by a short-hash prefix", () => {
    const commits = [
      commit("abcdef1", ["abc"]),
      commit("abc", []),
    ];
    const { edges } = computeGraphLayout(commits);
    expect(edges).toHaveLength(1);
    expect(edges[0].childIndex).toBe(0);
    expect(edges[0].parentIndex).toBe(1);
  });

  it("ignores parents that are not present in the loaded page", () => {
    const commits = [commit("only", ["missing-parent"])];
    const { edges } = computeGraphLayout(commits);
    expect(edges).toHaveLength(0);
  });
});

describe("computeGraphLayout colouring", () => {
  it("keeps a single branch on one colour", () => {
    const commits = [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];
    const { layouts } = computeGraphLayout(commits);

    expect(layouts["c"].colorIndex).toBe(0);
    expect(layouts["b"].colorIndex).toBe(0);
    expect(layouts["a"].colorIndex).toBe(0);
  });

  it("gives a merge's second-parent branch a different colour from the trunk", () => {
    const commits = [commit("m", ["a", "b"]), commit("b", ["a"]), commit("a", [])];
    const { layouts } = computeGraphLayout(commits);

    expect(layouts["m"].colorIndex).toBe(0);
    expect(layouts["b"].colorIndex).not.toBe(layouts["m"].colorIndex);
  });

  it("gives a reused lane a fresh colour so it does not repeat the previous branch", () => {
    const commits = [
      commit("x", ["root"]),
      commit("y", ["root"]),
      commit("root", []),
      commit("z", []),
    ];
    const { layouts } = computeGraphLayout(commits);

    // z reuses lane 0 (geometry) but is a new branch line, so its colour must
    // not collide with the earlier occupant of lane 0.
    expect(layouts["z"].lane).toBe(0);
    expect(layouts["z"].colorIndex).not.toBe(layouts["x"].colorIndex);
  });

  it("keeps a fork off the trunk off the trunk's colour even after the palette wraps", () => {
    // A trunk with seven short side branches that each merge in and immediately
    // root (freeing their lane). Every fork claims the next palette colour, so
    // by the seventh a naive per-claim counter would wrap back onto the trunk's
    // colour (0) — the exact "a branch off the red trunk is also red" bug. The
    // fork must instead skip the still-active trunk colour.
    const commits: CommitNode[] = [];
    for (let i = 1; i <= 7; i++) {
      const trunkParent = i < 7 ? `m${i + 1}` : "t";
      commits.push(commit(`m${i}`, [trunkParent, `s${i}`]));
      commits.push(commit(`s${i}`, []));
    }
    commits.push(commit("t", []));
    const { layouts } = computeGraphLayout(commits);

    // The trunk stays on colour 0 the whole way down.
    expect(layouts["m7"].colorIndex).toBe(0);
    // A naive counter would give the seventh fork 7 % 7 === 0 (== trunk); it
    // must not collide with the trunk it branches from.
    expect(layouts["s7"].colorIndex).not.toBe(layouts["m7"].colorIndex);
  });

  it("gives every lane of an octopus merge a distinct colour", () => {
    // o merges three roots, so three lanes are active on the same row.
    const commits = [
      commit("o", ["a", "b", "c"]),
      commit("a", []),
      commit("b", []),
      commit("c", []),
    ];
    const { layouts } = computeGraphLayout(commits);

    // o's lane (followed by first parent a), b and c are all concurrent.
    const colors = new Set([
      layouts["o"].colorIndex,
      layouts["b"].colorIndex,
      layouts["c"].colorIndex,
    ]);
    expect(colors.size).toBe(3);
  });

  it("colours a merge bend by the merged branch, not the trunk", () => {
    const commits = [commit("m", ["a", "b"]), commit("b", ["a"]), commit("a", [])];
    const { layouts, edges } = computeGraphLayout(commits);

    const mergeBend = edges.find((e) => e.childIndex === 0 && e.parentIndex === 1);
    expect(mergeBend?.colorIndex).toBe(layouts["b"].colorIndex);
  });
});

describe("laneX", () => {
  it("gives every lane its own column once a minimum width is set", () => {
    const sizing = laneSizing(9, DEFAULT_GEOMETRY);
    const beyond = laneX(DEFAULT_GEOMETRY.maxLane + 3, DEFAULT_GEOMETRY, sizing);
    const atMax = laneX(DEFAULT_GEOMETRY.maxLane, DEFAULT_GEOMETRY, sizing);
    expect(beyond).toBeGreaterThan(atMax);
  });

  it("collapses again past the column ceiling", () => {
    // A filtered list is not a walk: every commit whose parent was filtered
    // out holds a lane forever, so the count runs away. The ceiling is what
    // stops the gutter following it.
    const sizing = laneSizing(40, DEFAULT_GEOMETRY);
    expect(sizing.columns).toBe(DEFAULT_GEOMETRY.maxColumns);
    expect(laneX(39, DEFAULT_GEOMETRY, sizing)).toBe(laneX(11, DEFAULT_GEOMETRY, sizing));
    expect(sizing.gutter).toBe(laneSizing(12, DEFAULT_GEOMETRY).gutter);
  });

  it("still clamps when no minimum width is set", () => {
    const beyond = laneX(COLLAPSING.maxLane + 3, COLLAPSING);
    expect(beyond).toBe(laneX(COLLAPSING.maxLane, COLLAPSING));
  });

  it("puts lane 0 in the same place at any lane width", () => {
    expect(laneX(0, DEFAULT_GEOMETRY, laneSizing(9, DEFAULT_GEOMETRY))).toBe(
      laneX(0, DEFAULT_GEOMETRY, laneSizing(1, DEFAULT_GEOMETRY)),
    );
  });
});

describe("laneSizing", () => {
  const gutter = (lanes: number) => laneSizing(lanes, DEFAULT_GEOMETRY).gutter;
  const width = (lanes: number) => laneSizing(lanes, DEFAULT_GEOMETRY).laneWidth;

  it("leaves six lanes exactly as they are today", () => {
    for (let lanes = 1; lanes <= 6; lanes++) {
      expect(width(lanes)).toBe(DEFAULT_GEOMETRY.laneWidth);
      expect(gutter(lanes)).toBe(124);
    }
  });

  it("narrows the lanes rather than the commit messages", () => {
    // Seven to nine lanes all fit the budget the six already had.
    expect(width(7)).toBe(12);
    expect(width(8)).toBe(10);
    expect(width(9)).toBe(9);
    for (const lanes of [7, 8, 9]) {
      expect(gutter(lanes)).toBe(124);
    }
  });

  it("widens only once the lanes cannot narrow any further", () => {
    expect(width(10)).toBe(DEFAULT_GEOMETRY.laneWidthMin);
    expect(gutter(10)).toBeGreaterThan(124);
    expect(gutter(12)).toBeGreaterThan(gutter(10));
  });

  it("stops widening at the ceiling", () => {
    const capped = gutter(DEFAULT_GEOMETRY.maxColumns!);
    expect(gutter(40)).toBe(capped);
    expect(gutter(400)).toBe(capped);
  });

  it("keeps the gutter fixed when no minimum width is set", () => {
    expect(laneSizing(20, COLLAPSING)).toEqual(laneSizing(1, COLLAPSING));
  });
});

describe("edgePath", () => {
  it("draws a straight line when child and parent share a lane", () => {
    const edge: GraphEdge = {
      cx: 20,
      cy: 20,
      px: 20,
      py: 56,
      lane: 0,
      parentLane: 0,
      childIndex: 0,
      parentIndex: 1,
      colorIndex: 0,
    };
    expect(edgePath(edge, 36)).toBe("M 20 20 L 20 56");
  });

  it("draws a bend when the parent is in a different lane", () => {
    const edge: GraphEdge = {
      cx: 20,
      cy: 20,
      px: 34,
      py: 92,
      lane: 0,
      parentLane: 1,
      childIndex: 0,
      parentIndex: 2,
      colorIndex: 0,
    };
    const path = edgePath(edge, 36);
    expect(path.startsWith("M 20 20 C")).toBe(true);
    expect(path).toContain("L 34 92");
  });

  it("bends between two lanes that laneX collapsed onto the same column", () => {
    // Collapsed, lanes 6 and 7 share an x — deciding on x would skip the bend.
    const x = laneX(6, COLLAPSING);
    expect(x).toBe(laneX(7, COLLAPSING));
    const edge: GraphEdge = {
      cx: x,
      cy: 20,
      px: x,
      py: 92,
      lane: 6,
      parentLane: 7,
      childIndex: 0,
      parentIndex: 2,
      colorIndex: 0,
    };
    expect(edgePath(edge, 36)).toContain("C");
  });

  it("keeps a branch tail in its own lane and bends into the trunk only at the parent", () => {
    // Child on lane 1 (px < cx) merging back down to the trunk two rows below.
    const edge: GraphEdge = {
      cx: 34,
      cy: 20,
      px: 20,
      py: 92,
      lane: 1,
      parentLane: 0,
      childIndex: 0,
      parentIndex: 2,
      colorIndex: 1,
    };
    const path = edgePath(edge, 36);
    // Goes straight down the child's own lane first (no immediate bend that
    // would overlay the trunk), then curves into the parent's lane at the end.
    expect(path.startsWith("M 34 20 L 34 56")).toBe(true);
    expect(path.trimEnd().endsWith("20 92")).toBe(true);
  });
});

describe("firstParentRowIndex", () => {
  it("finds the row of the first parent in a simple chain", () => {
    const commits = [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];
    expect(firstParentRowIndex(commits, 0)).toBe(1);
    expect(firstParentRowIndex(commits, 1)).toBe(2);
  });

  it("returns null for a root commit with no parents", () => {
    const commits = [commit("a", [])];
    expect(firstParentRowIndex(commits, 0)).toBeNull();
  });

  it("returns null when the first parent is not loaded in the page", () => {
    const commits = [commit("only", ["missing-parent"])];
    expect(firstParentRowIndex(commits, 0)).toBeNull();
  });

  it("always follows the first parent from a merge commit, not the merged-in branch", () => {
    const commits = [commit("m", ["a", "b"]), commit("b", ["a"]), commit("a", [])];
    expect(firstParentRowIndex(commits, 0)).toBe(2); // "a" (index 2), not "b" (index 1)
  });

  it("resolves a short-hash parent reference by prefix", () => {
    const commits = [commit("abcdef1", ["abc"]), commit("abc", [])];
    expect(firstParentRowIndex(commits, 0)).toBe(1);
  });
});

describe("laneContinuationRowIndex", () => {
  it("finds the child that continues the same lane going up", () => {
    const commits = [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];
    const { edges } = computeGraphLayout(commits);
    expect(laneContinuationRowIndex(edges, 1)).toBe(0); // b's continuation is c
    expect(laneContinuationRowIndex(edges, 2)).toBe(1); // a's continuation is b
  });

  it("returns null for the newest commit on a lane", () => {
    const commits = [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];
    const { edges } = computeGraphLayout(commits);
    expect(laneContinuationRowIndex(edges, 0)).toBeNull();
  });

  it("skips the merge-in bend and finds the straight-line child at a fork", () => {
    // m merges a and b; from a's perspective going up, the straight
    // continuation is m (same lane), not the b->a bend.
    const commits = [commit("m", ["a", "b"]), commit("b", ["a"]), commit("a", [])];
    const { edges } = computeGraphLayout(commits);
    expect(laneContinuationRowIndex(edges, 2)).toBe(0); // a -> m, straight
  });

  it("skips a bend between two lanes that laneX collapsed onto one column", () => {
    // Row 0 bends in from lane 7, row 1 continues lane 6 straight. All three
    // share an x, so picking by x returns row 0 — it comes first.
    const x = laneX(6, COLLAPSING);
    const edges: GraphEdge[] = [
      {
        cx: x,
        cy: 20,
        px: x,
        py: 92,
        lane: 7,
        parentLane: 6,
        childIndex: 0,
        parentIndex: 2,
        colorIndex: 1,
      },
      {
        cx: x,
        cy: 56,
        px: x,
        py: 92,
        lane: 6,
        parentLane: 6,
        childIndex: 1,
        parentIndex: 2,
        colorIndex: 0,
      },
    ];
    expect(laneContinuationRowIndex(edges, 2)).toBe(1);
  });
});

describe("computeGraphLayout head lane", () => {
  // Two branches are newer than the one checked out — the everyday shape when
  // the graph shows all branches.
  const commits = [commit("newer", ["head"]), commit("other", ["head"]), commit("head", [])];

  it("gives HEAD the leftmost lane and bends the newer branches out", () => {
    const { layouts } = computeGraphLayout(commits, DEFAULT_GEOMETRY, "head");
    expect(layouts["head"].lane).toBe(0);
    expect(layouts["newer"].lane).toBeGreaterThan(0);
    expect(layouts["other"].lane).toBeGreaterThan(0);
  });

  it("leaves the lanes alone when no head is named", () => {
    // The sidebar's compact graph passes none, and must keep its old shape.
    const { layouts } = computeGraphLayout(commits, DEFAULT_GEOMETRY);
    expect(layouts["newer"].lane).toBe(0);
  });

  it("does not strand a lane on a head outside this page", () => {
    // A branch filter can hide HEAD entirely; reserving a lane for a hash that
    // never arrives would leave an empty column down the whole graph.
    const { layouts } = computeGraphLayout(commits, DEFAULT_GEOMETRY, "not-loaded");
    expect(layouts["newer"].lane).toBe(0);
  });

  it("is a no-op when HEAD is already the newest commit", () => {
    const headFirst = [commit("head", ["old"]), commit("old", [])];
    const { layouts } = computeGraphLayout(headFirst, DEFAULT_GEOMETRY, "head");
    expect(layouts["head"].lane).toBe(0);
    expect(layouts["old"].lane).toBe(0);
  });
});
