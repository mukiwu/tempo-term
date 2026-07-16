import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { gitWorktreeListDetailed, gitWorktreeDiskSize, gitWorktreeDirtyCount } = vi.hoisted(() => ({
  gitWorktreeListDetailed: vi.fn(),
  gitWorktreeDiskSize: vi.fn(),
  gitWorktreeDirtyCount: vi.fn(),
}));
vi.mock("./lib/worktreesBridge", () => ({
  gitWorktreeListDetailed,
  gitWorktreeDiskSize,
  gitWorktreeDirtyCount,
}));

const { gitResolveRepo } = vi.hoisted(() => ({ gitResolveRepo: vi.fn() }));
vi.mock("@/modules/source-control/lib/gitBridge", () => ({ gitResolveRepo }));

import "@/i18n";
import { useWorktreeRegistryStore } from "@/stores/worktreeRegistryStore";
import type { WorktreeDetail } from "./types";
import { useWorktreesStore } from "./lib/worktreesStore";
import { WorktreesModal } from "./WorktreesModal";

function detail(path: string, branch: string): WorktreeDetail {
  return {
    path,
    branch,
    head: "abc",
    isMain: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  gitWorktreeListDetailed.mockResolvedValue([]);
  gitWorktreeDirtyCount.mockResolvedValue(0);
  useWorktreeRegistryStore.setState({ byRepo: {} });
  useWorktreesStore.setState({ byRepo: {}, sizes: {} });
});

function register(repoPath: string) {
  useWorktreeRegistryStore.setState((state) => ({
    byRepo: {
      ...state.byRepo,
      [repoPath]: { repoPath, worktreeCount: 1, lastScannedAt: 0 },
    },
  }));
}

describe("WorktreesModal", () => {
  it("renders the global scope without re-rendering itself to death", () => {
    // A selector that builds a fresh array every call makes zustand v5 hand
    // useSyncExternalStore a new snapshot on every render, which React answers
    // by rendering again — forever. Opening the modal is enough to catch it.
    register("/repo/a");
    register("/repo/b");

    expect(() => render(<WorktreesModal state={{ scope: "global", repoPath: null }} />)).not.toThrow();
  });

  it("lists a repo's worktrees once the scan lands", async () => {
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo/a-worktrees/x", "feat/x")]);

    render(<WorktreesModal state={{ scope: "repo", repoPath: "/repo/a" }} />);

    expect(await screen.findByText("feat/x")).toBeInTheDocument();
    expect(gitWorktreeListDetailed).toHaveBeenCalledWith("/repo/a");
  });

  it("scans a repo once per open, not once per render", async () => {
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo/a-worktrees/x", "feat/x")]);

    const { rerender } = render(<WorktreesModal state={{ scope: "repo", repoPath: "/repo/a" }} />);
    await screen.findByText("feat/x");
    rerender(<WorktreesModal state={{ scope: "repo", repoPath: "/repo/a" }} />);

    expect(gitWorktreeListDetailed).toHaveBeenCalledTimes(1);
  });
});
