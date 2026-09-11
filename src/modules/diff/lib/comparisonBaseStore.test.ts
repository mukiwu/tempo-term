import { beforeEach, describe, expect, it } from "vitest";
import {
  baseFor,
  readComparison,
  readWorkingTree,
  useComparisonBaseStore,
  WORKTREE,
} from "./comparisonBaseStore";
import { useTabsStore } from "@/stores/tabsStore";

describe("comparisonBaseStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useComparisonBaseStore.setState({ byRepo: {}, includeUncommitted: true });
    useTabsStore.setState({ tabs: [], activeId: null });
  });

  it("compares against the working tree until told otherwise", () => {
    // What #397 shipped, and what every repo starts on: the base is a choice
    // the page can be given, not one it has to be given.
    expect(baseFor({}, "/repo")).toEqual(WORKTREE);
    // And with no repo resolved there is nothing to look up either.
    expect(baseFor({ "/repo": { kind: "ref", name: "origin/main" } }, null)).toEqual(WORKTREE);
  });

  it("keeps a base per repository", () => {
    // A base is a ref name, and `upstream/main` means nothing in the next
    // folder you open. Two roots inside one repo resolve to one path and so
    // share an answer; two repos must not.
    const store = useComparisonBaseStore.getState();
    store.setBase("/one", { kind: "ref", name: "origin/main" });
    store.setBase("/two", { kind: "range", from: "a", to: "b" });

    const { byRepo } = useComparisonBaseStore.getState();
    expect(baseFor(byRepo, "/one")).toEqual({ kind: "ref", name: "origin/main" });
    expect(baseFor(byRepo, "/two")).toEqual({ kind: "range", from: "a", to: "b" });
    expect(baseFor(byRepo, "/three")).toEqual(WORKTREE);
  });

  it("drops one repo's base without touching the others", () => {
    const store = useComparisonBaseStore.getState();
    store.setBase("/one", { kind: "ref", name: "gone/branch" });
    store.setBase("/two", { kind: "ref", name: "origin/main" });

    useComparisonBaseStore.getState().clear("/one");

    const { byRepo } = useComparisonBaseStore.getState();
    expect("/one" in byRepo).toBe(false);
    expect(baseFor(byRepo, "/two")).toEqual({ kind: "ref", name: "origin/main" });
    // Clearing a repo that has no base is not an error and changes nothing,
    // so a caller need not check first.
    const before = useComparisonBaseStore.getState().byRepo;
    useComparisonBaseStore.getState().clear("/nowhere");
    expect(useComparisonBaseStore.getState().byRepo).toBe(before);
  });

  it("reads a commit as the range from its parent", () => {
    // "The changes in this commit" is the two-dot range ending at it, which
    // is what both entry points -- the graph's details panel and the panel's
    // recent commits -- mean by handing over a single sha.
    readComparison("/repo", "52ccbba");

    expect(baseFor(useComparisonBaseStore.getState().byRepo, "/repo")).toEqual({
      kind: "range",
      from: "52ccbba^",
      to: "52ccbba",
    });
  });

  it("reads two named points as the range between them", () => {
    readComparison("/repo", "936578d", "2db2298");

    expect(baseFor(useComparisonBaseStore.getState().byRepo, "/repo")).toEqual({
      kind: "range",
      from: "936578d",
      to: "2db2298",
    });
  });

  it("brings the page up on the base it just set, every time", () => {
    // The two steps in one function because the second is easy to forget and
    // the page is a singleton: the second call focuses the tab that is
    // already there rather than building one, so a caller that only set the
    // base would leave the old comparison on screen under the new heading.
    readComparison("/repo", "aaaaaaa");
    const first = useTabsStore.getState().activeId;
    expect(useTabsStore.getState().tabs.filter((tab) => tab.kind === "all-changes")).toHaveLength(
      1,
    );

    useTabsStore.getState().openLauncherTab();
    expect(useTabsStore.getState().activeId).not.toBe(first);

    readComparison("/repo", "bbbbbbb");

    expect(useTabsStore.getState().tabs.filter((tab) => tab.kind === "all-changes")).toHaveLength(
      1,
    );
    expect(useTabsStore.getState().activeId).toBe(first);
    expect(baseFor(useComparisonBaseStore.getState().byRepo, "/repo")).toEqual({
      kind: "range",
      from: "bbbbbbb^",
      to: "bbbbbbb",
    });
  });

  it("reads the working tree by dropping the base, not by setting one", () => {
    // The graph's working-tree row is the one selection that is not a
    // comparison. Opening the page while it still held the last range would
    // answer that row with someone else's commits, so the base has to go --
    // and the page's own heading then reads as the working tree again.
    readComparison("/repo", "52ccbba");

    readWorkingTree("/repo");

    expect(baseFor(useComparisonBaseStore.getState().byRepo, "/repo")).toEqual(WORKTREE);
    expect(useTabsStore.getState().tabs.filter((tab) => tab.kind === "all-changes")).toHaveLength(
      1,
    );
  });

  it("leaves another repo's base alone while reading this one's working tree", () => {
    // The base is per repository, and the row belongs to one of them.
    useComparisonBaseStore.getState().setBase("/other", { kind: "ref", name: "origin/main" });

    readWorkingTree("/repo");

    expect(baseFor(useComparisonBaseStore.getState().byRepo, "/other")).toEqual({
      kind: "ref",
      name: "origin/main",
    });
  });
});
