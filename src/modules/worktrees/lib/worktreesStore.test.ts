import { beforeEach, describe, expect, it, vi } from "vitest";

const { gitWorktreeListDetailed, gitWorktreeDiskSize } = vi.hoisted(() => ({
  gitWorktreeListDetailed: vi.fn(),
  gitWorktreeDiskSize: vi.fn(),
}));
vi.mock("./worktreesBridge", () => ({ gitWorktreeListDetailed, gitWorktreeDiskSize }));

import { useWorktreeRegistryStore } from "@/stores/worktreeRegistryStore";
import type { WorktreeDetail } from "../types";
import { useWorktreesStore } from "./worktreesStore";

function detail(path: string, isMain = false): WorktreeDetail {
  return {
    path,
    branch: "b",
    head: "abc",
    isMain,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
  };
}

const store = () => useWorktreesStore.getState();

beforeEach(() => {
  useWorktreesStore.getState().reset();
  useWorktreeRegistryStore.setState({ byRepo: {} });
  gitWorktreeListDetailed.mockReset();
  gitWorktreeDiskSize.mockReset();
});

describe("worktreesStore.refresh", () => {
  it("caches the scan per repo", async () => {
    const details = [detail("/repo", true), detail("/repo-worktrees/x")];
    gitWorktreeListDetailed.mockResolvedValue(details);

    await store().refresh("/repo");

    expect(useWorktreesStore.getState().byRepo["/repo"]).toEqual(details);
  });

  it("registers the repo with its linked count, excluding the main worktree", async () => {
    gitWorktreeListDetailed.mockResolvedValue([
      detail("/repo", true),
      detail("/repo-worktrees/x"),
      detail("/repo-worktrees/y"),
    ]);

    await store().refresh("/repo");

    // The main checkout is not a worktree the user made, so the badge must not
    // count it.
    expect(useWorktreeRegistryStore.getState().byRepo["/repo"]?.worktreeCount).toBe(2);
  });

  it("does not register a repo that only has its main worktree", async () => {
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo", true)]);

    await store().refresh("/repo");

    expect(useWorktreeRegistryStore.getState().byRepo["/repo"]).toBeUndefined();
  });

  it("de-dupes concurrent scans of the same repo into one subprocess", async () => {
    // Two rows mounting at once must not spawn `git worktree list` twice.
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo", true)]);

    const [a, b] = await Promise.all([store().refresh("/repo"), store().refresh("/repo")]);

    expect(gitWorktreeListDetailed).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("scans again after the previous one settles", async () => {
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo", true)]);

    await store().refresh("/repo");
    await store().refresh("/repo");

    expect(gitWorktreeListDetailed).toHaveBeenCalledTimes(2);
  });

  it("forgets a repo whose path no longer resolves", async () => {
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo", true), detail("/repo-wt/x")]);
    await store().refresh("/repo");
    expect(useWorktreeRegistryStore.getState().byRepo["/repo"]).toBeDefined();

    // The repo was deleted or moved out from under us.
    gitWorktreeListDetailed.mockRejectedValue(new Error("not a git repository"));
    await expect(store().refresh("/repo")).rejects.toThrow();

    expect(useWorktreeRegistryStore.getState().byRepo["/repo"]).toBeUndefined();
    expect(useWorktreesStore.getState().byRepo["/repo"]).toBeUndefined();
  });
});

describe("worktreesStore.loadSize", () => {
  it("caches the measured size", async () => {
    gitWorktreeDiskSize.mockResolvedValue(4096);

    await store().loadSize("/repo-worktrees/x");

    expect(useWorktreesStore.getState().sizes["/repo-worktrees/x"]).toBe(4096);
  });

  it("de-dupes concurrent walks of the same worktree", async () => {
    // The walk is tens of thousands of files; running it twice is the one thing
    // this must never do.
    gitWorktreeDiskSize.mockResolvedValue(4096);

    await Promise.all([store().loadSize("/wt"), store().loadSize("/wt")]);

    expect(gitWorktreeDiskSize).toHaveBeenCalledTimes(1);
  });
});
