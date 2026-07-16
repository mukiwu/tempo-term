import { render, screen, fireEvent } from "@testing-library/react";
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
  gitWorktreeAdd: vi.fn(),
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

  it("can start a new worktree from the repo it is scoped to", async () => {
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo/a-worktrees/x", "feat/x")]);

    render(<WorktreesModal state={{ scope: "repo", repoPath: "/repo/a" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /new/i }));

    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("names the repo on each group's New button, since global scope has several", async () => {
    // The badge is the only way in today, and it always opens global scope — so
    // without this, creating a worktree would be unreachable.
    register("/repo/a");
    register("/repo/b");
    gitWorktreeListDetailed.mockImplementation((repo: string) =>
      Promise.resolve([detail(`${repo}-worktrees/x`, "feat/x")]),
    );

    render(<WorktreesModal state={{ scope: "global", repoPath: null }} />);

    expect(await screen.findByRole("button", { name: /new: a/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new: b/i })).toBeInTheDocument();
  });

  it("scans a repo once per open, not once per render", async () => {
    gitWorktreeListDetailed.mockResolvedValue([detail("/repo/a-worktrees/x", "feat/x")]);

    const { rerender } = render(<WorktreesModal state={{ scope: "repo", repoPath: "/repo/a" }} />);
    await screen.findByText("feat/x");
    rerender(<WorktreesModal state={{ scope: "repo", repoPath: "/repo/a" }} />);

    expect(gitWorktreeListDetailed).toHaveBeenCalledTimes(1);
  });
});
