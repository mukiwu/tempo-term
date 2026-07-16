import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { gitWorktreeRemove, gitWorktreeListDetailed, gitWorktreeDiskSize, gitWorktreeAdd, gitWorktreePrune } =
  vi.hoisted(() => ({
    gitWorktreeRemove: vi.fn(),
    gitWorktreeListDetailed: vi.fn(),
    gitWorktreeDiskSize: vi.fn(),
    gitWorktreeAdd: vi.fn(),
    gitWorktreePrune: vi.fn(),
  }));
vi.mock("./lib/worktreesBridge", () => ({
  gitWorktreeRemove,
  gitWorktreeListDetailed,
  gitWorktreeDiskSize,
  gitWorktreeAdd,
  gitWorktreePrune,
}));

import "@/i18n";
import { useTabsStore } from "@/stores/tabsStore";
import type { WorktreeDetail } from "./types";
import { useWorktreesStore } from "./lib/worktreesStore";
import { RemoveWorktreeDialog } from "./RemoveWorktreeDialog";

const REPO = "/code/app";
const WT = "/code/app-worktrees/feat-x";

function detail(overrides: Partial<WorktreeDetail> = {}): WorktreeDetail {
  return {
    path: WT,
    branch: "feat/x",
    head: "abc",
    isMain: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  gitWorktreeRemove.mockResolvedValue(undefined);
  gitWorktreeListDetailed.mockResolvedValue([]);
  useWorktreesStore.setState({ byRepo: {}, sizes: {} });
  useTabsStore.setState({ tabs: [], activeId: null, spaces: [{ id: "s1", name: "S" }], activeSpaceId: "s1" });
});

const confirmButton = () => screen.getByRole("button", { name: /remove/i });
const discardBox = () => screen.getByRole("checkbox", { name: /discard/i });
const branchBox = () => screen.getByRole("checkbox", { name: /branch/i });

describe("RemoveWorktreeDialog — a clean worktree", () => {
  it("removes it, keeping the branch, forcing nothing", async () => {
    render(<RemoveWorktreeDialog repoPath={REPO} detail={detail()} dirty={0} onDone={vi.fn()} />);

    fireEvent.click(confirmButton());

    await waitFor(() => expect(gitWorktreeRemove).toHaveBeenCalled());
    expect(gitWorktreeRemove).toHaveBeenCalledWith(REPO, WT, undefined, false, false);
  });

  it("keeps the branch unless it is asked to take it", async () => {
    render(<RemoveWorktreeDialog repoPath={REPO} detail={detail()} dirty={0} onDone={vi.fn()} />);

    expect(branchBox()).not.toBeChecked();
    fireEvent.click(branchBox());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(gitWorktreeRemove).toHaveBeenCalled());
    expect(gitWorktreeRemove).toHaveBeenCalledWith(REPO, WT, "feat/x", false, false);
  });
});

describe("RemoveWorktreeDialog — uncommitted work", () => {
  it("will not go through until the loss is acknowledged in so many words", () => {
    render(<RemoveWorktreeDialog repoPath={REPO} detail={detail()} dirty={3} onDone={vi.fn()} />);

    expect(confirmButton()).toBeDisabled();
    expect(discardBox()).not.toBeChecked();
  });

  it("says how much is at stake rather than that there is some", () => {
    render(<RemoveWorktreeDialog repoPath={REPO} detail={detail()} dirty={3} onDone={vi.fn()} />);

    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it("forces only once the box is ticked, and never on its own", async () => {
    render(<RemoveWorktreeDialog repoPath={REPO} detail={detail()} dirty={3} onDone={vi.fn()} />);

    fireEvent.click(discardBox());
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(gitWorktreeRemove).toHaveBeenCalled());
    // force=true is the last argument, and it got there only via the checkbox.
    expect(gitWorktreeRemove).toHaveBeenCalledWith(REPO, WT, undefined, false, true);
  });

  it("does not ask a clean worktree to acknowledge a loss that is not happening", () => {
    render(<RemoveWorktreeDialog repoPath={REPO} detail={detail()} dirty={0} onDone={vi.fn()} />);

    expect(screen.queryByRole("checkbox", { name: /discard/i })).not.toBeInTheDocument();
  });

  it("treats a count that has not landed as something to lose", () => {
    render(<RemoveWorktreeDialog repoPath={REPO} detail={detail()} dirty={null} onDone={vi.fn()} />);

    expect(confirmButton()).toBeDisabled();
  });
});

describe("RemoveWorktreeDialog — what it refuses outright", () => {
  it("will not remove the repo's own working tree", () => {
    render(<RemoveWorktreeDialog repoPath={REPO} detail={detail({ isMain: true })} dirty={0} onDone={vi.fn()} />);

    expect(confirmButton()).toBeDisabled();
    // No checkbox can get past this one — it is not a confirmation away.
    expect(screen.queryByRole("checkbox", { name: /discard/i })).not.toBeInTheDocument();
  });

  it("will not remove a locked worktree, and repeats the reason someone left", () => {
    render(
      <RemoveWorktreeDialog
        repoPath={REPO}
        detail={detail({ locked: true, lockReason: "running a long build" })}
        dirty={0}
        onDone={vi.fn()}
      />,
    );

    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText(/running a long build/)).toBeInTheDocument();
  });

  it("lets a worktree whose directory is already gone be dropped without ceremony", async () => {
    render(
      <RemoveWorktreeDialog repoPath={REPO} detail={detail({ prunable: true })} dirty={null} onDone={vi.fn()} />,
    );

    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(gitWorktreeRemove).toHaveBeenCalled());
  });
});

describe("RemoveWorktreeDialog — when git says no", () => {
  it("stays open and repeats git's own words", async () => {
    gitWorktreeRemove.mockRejectedValue("fatal: 'feat/x' is not fully merged");
    const onDone = vi.fn();

    render(<RemoveWorktreeDialog repoPath={REPO} detail={detail()} dirty={0} onDone={onDone} />);
    fireEvent.click(confirmButton());

    expect(await screen.findByText(/not fully merged/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});
