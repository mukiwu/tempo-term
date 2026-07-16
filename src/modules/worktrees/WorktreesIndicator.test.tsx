import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "@/i18n";
import { useUiStore } from "@/stores/uiStore";
import { useWorktreeRegistryStore } from "@/stores/worktreeRegistryStore";
import { WorktreesIndicator } from "./WorktreesIndicator";

beforeEach(() => {
  useWorktreeRegistryStore.setState({ byRepo: {} });
  useUiStore.setState({ worktreesModal: null });
});

function register(repoPath: string, worktreeCount: number) {
  useWorktreeRegistryStore.setState((state) => ({
    byRepo: {
      ...state.byRepo,
      [repoPath]: { repoPath, worktreeCount, lastScannedAt: 0 },
    },
  }));
}

describe("WorktreesIndicator", () => {
  it("stays out of the status bar when there is nothing to watch", () => {
    const { container } = render(<WorktreesIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it("totals worktrees across every known repo", () => {
    register("/a", 2);
    register("/b", 3);
    render(<WorktreesIndicator />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("opens the manager on everything, since the badge is the global entry", () => {
    register("/a", 2);
    render(<WorktreesIndicator />);

    fireEvent.click(screen.getByRole("button"));

    expect(useUiStore.getState().worktreesModal).toEqual({ scope: "global", repoPath: null });
  });
});
