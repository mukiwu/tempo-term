import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { gitWorktreeDirtyCount } = vi.hoisted(() => ({ gitWorktreeDirtyCount: vi.fn() }));
vi.mock("./lib/worktreesBridge", () => ({ gitWorktreeDirtyCount }));

import "@/i18n";
import type { WorktreeDetail } from "./types";
import { WorktreeRow } from "./WorktreeRow";

function detail(overrides: Partial<WorktreeDetail> = {}): WorktreeDetail {
  return {
    path: "/repo-worktrees/x",
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
  gitWorktreeDirtyCount.mockResolvedValue(3);
});

describe("WorktreeRow", () => {
  it("drops a dirty count once the directory turns out to be gone", async () => {
    const { rerender } = render(<WorktreeRow detail={detail()} />);
    expect(await screen.findByText(/3/)).toBeInTheDocument();

    // Same path, so React keeps this row's component instance — and with it the
    // count it already loaded. Nothing is left to be dirty once the directory is.
    rerender(<WorktreeRow detail={detail({ prunable: true })} />);

    expect(screen.queryByText(/3/)).not.toBeInTheDocument();
  });

  it("does not count a directory that is already gone", () => {
    render(<WorktreeRow detail={detail({ prunable: true })} />);
    expect(gitWorktreeDirtyCount).not.toHaveBeenCalled();
  });
});
