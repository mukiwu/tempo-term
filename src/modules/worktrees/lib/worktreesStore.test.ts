import { beforeEach, describe, expect, it, vi } from "vitest";

const { gitWorktreeListDetailed, gitWorktreeDiskSize, gitWorktreeAdd, gitWorktreeRemove, gitWorktreePrune } =
  vi.hoisted(() => ({
    gitWorktreeListDetailed: vi.fn(),
    gitWorktreeDiskSize: vi.fn(),
    gitWorktreeAdd: vi.fn(),
    gitWorktreeRemove: vi.fn(),
    gitWorktreePrune: vi.fn(),
  }));
vi.mock("./worktreesBridge", () => ({
  gitWorktreeListDetailed,
  gitWorktreeDiskSize,
  gitWorktreeAdd,
  gitWorktreeRemove,
  gitWorktreePrune,
}));

const { gitResolveRepo } = vi.hoisted(() => ({ gitResolveRepo: vi.fn() }));
vi.mock("@/modules/source-control/lib/gitBridge", () => ({ gitResolveRepo }));

import { useWorktreeRegistryStore } from "@/stores/worktreeRegistryStore";
import type { WorktreeDetail } from "../types";
import { useWorktreesStore } from "./worktreesStore";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";

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
  gitResolveRepo.mockReset();
  gitResolveRepo.mockResolvedValue("/repo");
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

  it("forgets a repo once its path really stops being one", async () => {
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo", true), detail("/repo-wt/x")]);
    await store().refresh("/repo");
    expect(useWorktreeRegistryStore.getState().byRepo["/repo"]).toBeDefined();

    // The repo was deleted or moved out from under us.
    gitWorktreeListDetailed.mockRejectedValue(new Error("not a git repository"));
    gitResolveRepo.mockResolvedValue(null);
    await expect(store().refresh("/repo")).rejects.toThrow();

    expect(useWorktreeRegistryStore.getState().byRepo["/repo"]).toBeUndefined();
    expect(useWorktreesStore.getState().byRepo["/repo"]).toBeUndefined();
  });

  it("keeps a repo when the scan fails but the repo is still there", async () => {
    // A git lock or a spawn hiccup fails exactly like a deleted repo. Dropping
    // the entry would under-count the badge silently, which is the one failure
    // mode nobody would notice.
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo", true), detail("/repo-wt/x")]);
    await store().refresh("/repo");

    gitWorktreeListDetailed.mockRejectedValue(new Error("index.lock exists"));
    gitResolveRepo.mockResolvedValue("/repo");
    await expect(store().refresh("/repo")).rejects.toThrow();

    expect(useWorktreeRegistryStore.getState().byRepo["/repo"]?.worktreeCount).toBe(1);
  });

  it("keeps a repo when even the probe fails, rather than forgetting on a guess", async () => {
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo", true), detail("/repo-wt/x")]);
    await store().refresh("/repo");

    gitWorktreeListDetailed.mockRejectedValue(new Error("boom"));
    gitResolveRepo.mockRejectedValue(new Error("probe also failed"));
    await expect(store().refresh("/repo")).rejects.toThrow();

    expect(useWorktreeRegistryStore.getState().byRepo["/repo"]).toBeDefined();
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

describe("create", () => {
  it("adds the worktree and reports back where it landed", async () => {
    gitWorktreeAdd.mockResolvedValue({ path: "/repo-worktrees/feat-x", branch: "feat/x" });
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo", true), detail("/repo-worktrees/feat-x")]);

    const result = await store().create("/repo", "feat/x", "/repo-worktrees/feat-x");

    expect(gitWorktreeAdd).toHaveBeenCalledWith("/repo", "/repo-worktrees/feat-x", "feat/x", true, undefined);
    expect(result.path).toBe("/repo-worktrees/feat-x");
  });

  it("rescans the repo, so the new worktree is listed and counted without asking", async () => {
    gitWorktreeAdd.mockResolvedValue({ path: "/repo-worktrees/feat-x", branch: "feat/x" });
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo", true), detail("/repo-worktrees/feat-x")]);

    await store().create("/repo", "feat/x", "/repo-worktrees/feat-x");

    expect(useWorktreesStore.getState().byRepo["/repo"]).toHaveLength(2);
    expect(useWorktreeRegistryStore.getState().byRepo["/repo"].worktreeCount).toBe(1);
  });

  it("still reports success when only the rescan failed — the worktree is on disk", async () => {
    // The worktree exists. Saying otherwise leaves the form open on a lie, and
    // the retry then fails with "branch already exists".
    gitWorktreeAdd.mockResolvedValue({ path: "/repo-worktrees/feat-x", branch: "feat/x" });
    gitWorktreeListDetailed.mockRejectedValue("fatal: could not lock index");
    gitResolveRepo.mockResolvedValue("/repo");

    await expect(store().create("/repo", "feat/x", "/repo-worktrees/feat-x")).resolves.toEqual({
      path: "/repo-worktrees/feat-x",
      branch: "feat/x",
    });
  });

  it("does not rescan when the add failed — there is nothing new to find", async () => {
    gitWorktreeAdd.mockRejectedValue("branch already exists: feat/x");

    await expect(store().create("/repo", "feat/x", "/repo-worktrees/feat-x")).rejects.toBe(
      "branch already exists: feat/x",
    );
    expect(gitWorktreeListDetailed).not.toHaveBeenCalled();
  });
});

describe("remove", () => {
  it("closes the terminals sitting in the worktree before git touches it", async () => {
    // Order is the point: on Windows a live pty holds its cwd open, and the
    // removal fails halfway, leaving git pointing at a half-gone directory.
    const order: string[] = [];
    useTabsStore.setState({
      tabs: [
        {
          id: "t1",
          spaceId: "s1",
          title: "t1",
          kind: "terminal",
          paneTree: leaf("p1", { kind: "terminal", cwd: "/repo-worktrees/feat-x" }),
          activeLeafId: "p1",
          paneOrder: ["p1", "p2"],
        },
      ],
      activeId: "t1",
      spaces: [{ id: "s1", name: "S" }],
      activeSpaceId: "s1",
    });
    const closePane = vi.fn(() => order.push("closePane"));
    useTabsStore.setState({ closePane });
    gitWorktreeRemove.mockImplementation(() => {
      order.push("gitWorktreeRemove");
      return Promise.resolve();
    });
    gitWorktreeListDetailed.mockResolvedValue([]);

    await store().remove("/repo", "/repo-worktrees/feat-x");

    expect(order).toEqual(["closePane", "gitWorktreeRemove"]);
    expect(closePane).toHaveBeenCalledWith("t1", "p1");
  });

  it("never forces unless asked", async () => {
    gitWorktreeRemove.mockResolvedValue(undefined);
    gitWorktreeListDetailed.mockResolvedValue([]);

    await store().remove("/repo", "/repo-worktrees/feat-x");

    expect(gitWorktreeRemove).toHaveBeenCalledWith("/repo", "/repo-worktrees/feat-x", undefined, false, false);
  });

  it("passes force and the branch through when they were asked for", async () => {
    gitWorktreeRemove.mockResolvedValue(undefined);
    gitWorktreeListDetailed.mockResolvedValue([]);

    await store().remove("/repo", "/repo-worktrees/feat-x", {
      deleteBranch: "feat/x",
      forceDeleteBranch: true,
      force: true,
    });

    expect(gitWorktreeRemove).toHaveBeenCalledWith("/repo", "/repo-worktrees/feat-x", "feat/x", true, true);
  });

  it("still reports success when only the rescan failed — gone is gone", async () => {
    gitWorktreeRemove.mockResolvedValue(undefined);
    gitWorktreeListDetailed.mockRejectedValue("fatal: could not lock index");
    gitResolveRepo.mockResolvedValue("/repo");

    await expect(store().remove("/repo", "/repo-worktrees/feat-x")).resolves.toBeUndefined();
  });

  it("forgets a removed worktree's measured size", async () => {
    gitWorktreeRemove.mockResolvedValue(undefined);
    gitWorktreeListDetailed.mockResolvedValue([]);
    useWorktreesStore.setState({ sizes: { "/repo-worktrees/feat-x": 4096 } });

    await store().remove("/repo", "/repo-worktrees/feat-x");

    expect(useWorktreesStore.getState().sizes["/repo-worktrees/feat-x"]).toBeUndefined();
  });
});

describe("prune", () => {
  it("reports what git dropped and rescans", async () => {
    gitWorktreePrune.mockResolvedValue(["Removing worktrees/feat-x: gitdir file points to non-existent location"]);
    gitWorktreeListDetailed.mockResolvedValue([]);

    const pruned = await store().prune("/repo");

    expect(pruned).toHaveLength(1);
    expect(gitWorktreeListDetailed).toHaveBeenCalledWith("/repo");
  });
});
