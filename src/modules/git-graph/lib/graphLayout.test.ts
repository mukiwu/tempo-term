import { describe, expect, it } from "vitest";
import {
  computeGraphLayout,
  DEFAULT_GEOMETRY,
  edgePath,
  laneX,
  type GraphEdge,
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

  it("colours a merge bend by the merged branch, not the trunk", () => {
    const commits = [commit("m", ["a", "b"]), commit("b", ["a"]), commit("a", [])];
    const { layouts, edges } = computeGraphLayout(commits);

    const mergeBend = edges.find((e) => e.childIndex === 0 && e.parentIndex === 1);
    expect(mergeBend?.colorIndex).toBe(layouts["b"].colorIndex);
  });
});

describe("laneX", () => {
  it("clamps lanes past maxLane onto the last column", () => {
    const beyond = laneX(DEFAULT_GEOMETRY.maxLane + 3, DEFAULT_GEOMETRY);
    const atMax = laneX(DEFAULT_GEOMETRY.maxLane, DEFAULT_GEOMETRY);
    expect(beyond).toBe(atMax);
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
      childIndex: 0,
      parentIndex: 2,
      colorIndex: 0,
    };
    const path = edgePath(edge, 36);
    expect(path.startsWith("M 20 20 C")).toBe(true);
    expect(path).toContain("L 34 92");
  });
});
