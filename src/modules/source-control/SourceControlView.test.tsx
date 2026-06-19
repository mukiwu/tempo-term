import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { useWorkspaceStore } from "@/stores/workspaceStore";

// The view talks to git through the Tauri bridge; stub it so the component can
// mount in jsdom and so a test can hold gitStatus pending to observe the busy
// state.
let resolveStatus!: (value: unknown) => void;
const gitStatus = vi.fn(
  () =>
    new Promise((resolve) => {
      resolveStatus = resolve;
    }),
);

vi.mock("./lib/gitBridge", () => ({
  gitResolveRepo: vi.fn().mockResolvedValue("/repo"),
  gitStatus: () => gitStatus(),
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

beforeEach(() => {
  gitStatus.mockClear();
  useWorkspaceStore.setState({ rootPath: "/root" });
});

describe("SourceControlView refresh feedback", () => {
  it("spins and disables the refresh button while a reload is in flight", async () => {
    render(<SourceControlView />);

    // The mount effect resolves the repo then kicks off a refresh that stays
    // pending until we release gitStatus.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /refresh/i })).toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: /refresh/i }).querySelector(".animate-spin"),
    ).not.toBeNull();

    resolveStatus({ branch: "main", staged: [], unstaged: [], untracked: [] });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /refresh/i })).not.toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: /refresh/i }).querySelector(".animate-spin"),
    ).toBeNull();
  });
});
