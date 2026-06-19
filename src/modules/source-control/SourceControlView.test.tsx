import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { useWorkspaceStore } from "@/stores/workspaceStore";

vi.mock("./lib/gitBridge", () => ({
  gitResolveRepo: vi.fn().mockResolvedValue("/repo"),
  gitStatus: vi.fn(),
  gitLog: vi.fn().mockResolvedValue([]),
  gitDiff: vi.fn().mockResolvedValue(""),
  gitStage: vi.fn().mockResolvedValue(undefined),
  gitUnstage: vi.fn().mockResolvedValue(undefined),
  gitCommit: vi.fn().mockResolvedValue(undefined),
  gitPush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./lib/aiCommit", () => ({
  generateCommitMessage: vi.fn().mockResolvedValue(""),
}));

import { SourceControlView } from "./SourceControlView";
import * as gitBridge from "./lib/gitBridge";
import type { GitStatus } from "./lib/gitBridge";

describe("SourceControlView folder view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitBridge.gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitBridge.gitLog).mockResolvedValue([]);
    vi.mocked(gitBridge.gitStage).mockResolvedValue(undefined);
    vi.mocked(gitBridge.gitUnstage).mockResolvedValue(undefined);
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [
        { path: "src/a.ts", staged: false, status: "M" },
        { path: "src/b.ts", staged: false, status: "M" },
        { path: "docs/c.md", staged: false, status: "M" },
      ],
    });
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("stages every file in a folder when the folder's stage button is clicked", async () => {
    render(<SourceControlView />);
    await screen.findByText("src/a.ts");

    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    const stageSrc = await screen.findByRole("button", { name: "Stage folder: src" });
    fireEvent.click(stageSrc);

    await waitFor(() => {
      expect(gitBridge.gitStage).toHaveBeenCalledWith("/repo", "src/a.ts");
    });
    expect(gitBridge.gitStage).toHaveBeenCalledWith("/repo", "src/b.ts");
    expect(gitBridge.gitStage).not.toHaveBeenCalledWith("/repo", "docs/c.md");
  });

  it("unstages every file in a folder when the folder's unstage button is clicked", async () => {
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({
      branch: "main",
      staged: [
        { path: "src/a.ts", staged: true, status: "M" },
        { path: "src/b.ts", staged: true, status: "M" },
      ],
      unstaged: [],
    });

    render(<SourceControlView />);
    await screen.findByText("src/a.ts");

    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    const unstageSrc = await screen.findByRole("button", { name: "Unstage folder: src" });
    fireEvent.click(unstageSrc);

    await waitFor(() => {
      expect(gitBridge.gitUnstage).toHaveBeenCalledWith("/repo", "src/a.ts");
    });
    expect(gitBridge.gitUnstage).toHaveBeenCalledWith("/repo", "src/b.ts");
  });

  it("labels an untracked directory entry by name in folder view, not a blank row", async () => {
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [{ path: "a/b/dir/", staged: false, status: "?" }],
    });

    render(<SourceControlView />);
    await screen.findByText("a/b/dir/"); // flat view shows the full path

    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    // Grouped under "a/b", the row keeps a readable "dir/" label.
    expect(await screen.findByText("dir/")).toBeInTheDocument();
  });
});

describe("SourceControlView refresh feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitBridge.gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitBridge.gitLog).mockResolvedValue([]);
    useWorkspaceStore.setState({ rootPath: "/root" });
  });

  it("spins and disables the refresh button while a reload is in flight", async () => {
    // Hold gitStatus pending so the refresh stays in flight while we assert.
    let resolveStatus!: (value: GitStatus) => void;
    vi.mocked(gitBridge.gitStatus).mockImplementation(
      () =>
        new Promise<GitStatus>((resolve) => {
          resolveStatus = resolve;
        }),
    );

    render(<SourceControlView />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /refresh/i })).toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: /refresh/i }).querySelector(".animate-spin"),
    ).not.toBeNull();

    resolveStatus({ branch: "main", staged: [], unstaged: [] });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /refresh/i })).not.toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: /refresh/i }).querySelector(".animate-spin"),
    ).toBeNull();
  });
});
