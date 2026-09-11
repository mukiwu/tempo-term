import { beforeEach, describe, expect, it } from "vitest";
import { openChangesInTab } from "./openChangesInTab";
import {
  baseFor,
  useComparisonBaseStore,
  WORKTREE,
} from "@/modules/diff/lib/comparisonBaseStore";
import { useTabsStore } from "@/stores/tabsStore";
import type { CommitNode } from "../types";

function commit(hash: string, parents: string[]): CommitNode {
  return {
    hash,
    parents,
    subject: hash,
    author: "a",
    email: "a@example.com",
    date: "2026-01-01T00:00:00Z",
    refs: [],
  } as unknown as CommitNode;
}

describe("openChangesInTab", () => {
  beforeEach(() => {
    localStorage.clear();
    useComparisonBaseStore.setState({ byRepo: {}, includeUncommitted: true });
    useTabsStore.setState({ tabs: [], activeId: null });
  });

  it("opens the working-tree row on the working tree", () => {
    // The row summarises uncommitted work, so the page it opens has to be
    // showing uncommitted work -- not whatever range was last read. Without
    // this the row is the one selection the panel offers no button for at all.
    useComparisonBaseStore.getState().setBase("/repo", { kind: "range", from: "a", to: "b" });

    const open = openChangesInTab("/repo", { mode: "workspace" });
    expect(open).toBeDefined();
    open?.();

    expect(baseFor(useComparisonBaseStore.getState().byRepo, "/repo")).toEqual(WORKTREE);
    expect(useTabsStore.getState().tabs.filter((tab) => tab.kind === "all-changes")).toHaveLength(
      1,
    );
  });

  it("opens a commit as the range from its parent, naming the parent outright", () => {
    // Not `52ccbba^..52ccbba`. The graph is holding the parent already, and
    // the base is shown to the reader: two hashes say what is being compared,
    // where a caret and a near-identical repeat has to be worked out.
    openChangesInTab("/repo", { mode: "single", commit: commit("52ccbba", ["ffff000"]) })?.();

    expect(baseFor(useComparisonBaseStore.getState().byRepo, "/repo")).toEqual({
      kind: "range",
      from: "ffff000",
      to: "52ccbba",
    });
  });

  it("takes the first parent of a merge, which is what its diff is read against", () => {
    openChangesInTab("/repo", {
      mode: "single",
      commit: commit("aaaaaaa", ["1111111", "2222222"]),
    })?.();

    expect(baseFor(useComparisonBaseStore.getState().byRepo, "/repo")).toEqual({
      kind: "range",
      from: "1111111",
      to: "aaaaaaa",
    });
  });

  it("opens two selected commits as the range between them", () => {
    openChangesInTab("/repo", {
      mode: "compare",
      from: commit("936578d", []),
      to: commit("2db2298", []),
    })?.();

    expect(baseFor(useComparisonBaseStore.getState().byRepo, "/repo")).toEqual({
      kind: "range",
      from: "936578d",
      to: "2db2298",
    });
  });

  it("offers nothing for a root commit, which has no parent to compare against", () => {
    expect(
      openChangesInTab("/repo", { mode: "single", commit: commit("aaaaaaa", []) }),
    ).toBeUndefined();
  });

  it("offers nothing before a repo has been resolved", () => {
    expect(openChangesInTab(null, { mode: "workspace" })).toBeUndefined();
  });
});
