import { beforeEach, describe, expect, it } from "vitest";
import { selectTotalWorktrees, useWorktreeRegistryStore } from "./worktreeRegistryStore";

const store = () => useWorktreeRegistryStore.getState();

beforeEach(() => useWorktreeRegistryStore.setState({ byRepo: {} }));

describe("worktreeRegistryStore", () => {
  it("does not remember a repo that has no linked worktrees", () => {
    // Every repo the user opens a terminal in gets scanned; only the ones
    // actually using worktrees belong in the registry, or it would grow to
    // every repo they have ever touched.
    store().record("/repo", 0);
    expect(store().entries()).toEqual([]);
  });

  it("remembers a repo once it has one", () => {
    store().record("/repo", 2, 111);
    expect(store().entries()).toEqual([
      { repoPath: "/repo", worktreeCount: 2, lastScannedAt: 111 },
    ]);
  });

  it("forgets a repo whose last worktree is gone", () => {
    store().record("/repo", 1);
    store().record("/repo", 0);
    expect(store().entries()).toEqual([]);
  });

  it("skips the write when a rescan finds the same count", () => {
    // Rescans are frequent; churning the state would wake every subscriber.
    store().record("/repo", 2, 111);
    const before = useWorktreeRegistryStore.getState().byRepo;
    store().record("/repo", 2, 999);
    expect(useWorktreeRegistryStore.getState().byRepo).toBe(before);
  });

  it("updates the count and timestamp when it changes", () => {
    store().record("/repo", 2, 111);
    store().record("/repo", 3, 222);
    expect(store().entries()[0]).toEqual({
      repoPath: "/repo",
      worktreeCount: 3,
      lastScannedAt: 222,
    });
  });

  it("forgets on demand", () => {
    store().record("/repo", 2);
    store().forget("/repo");
    expect(store().entries()).toEqual([]);
  });

  it("totals linked worktrees across repos for the badge", () => {
    store().record("/a", 2);
    store().record("/b", 3);
    expect(selectTotalWorktrees(useWorktreeRegistryStore.getState())).toBe(5);
  });

  it("totals zero when nothing is registered, so the badge can hide", () => {
    expect(selectTotalWorktrees(useWorktreeRegistryStore.getState())).toBe(0);
  });
});
