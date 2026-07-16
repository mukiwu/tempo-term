import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// The worktree menu drags in the worktree store (and its Tauri invokes);
// its own behavior is covered elsewhere.
vi.mock("@/modules/worktrees/PaneWorktreeMenu", () => ({
  usePaneRepoPath: () => null,
  PaneWorktreeMenu: () => null,
}));

const { fsHomeDir, fsReadDir, writeToTerminal } = vi.hoisted(() => ({
  fsHomeDir: vi.fn(),
  fsReadDir: vi.fn(),
  writeToTerminal: vi.fn(),
}));

vi.mock("@/modules/explorer/lib/fsBridge", () => ({ fsHomeDir, fsReadDir }));
vi.mock("./lib/terminalBus", () => ({ writeToTerminal }));

import { TerminalPaneHeader } from "./TerminalPaneHeader";

describe("TerminalPaneHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsHomeDir.mockResolvedValue("/Users/muki");
    // The workspace root must NOT affect the trail: it follows the focused
    // terminal's cwd, and a trail anchored to it re-roots on focus changes.
    useWorkspaceStore.setState({ rootPath: "/Users/muki/w/tempo-term" });
  });

  it("shows the stable home-relative trail regardless of the workspace root", async () => {
    render(
      <TerminalPaneHeader
        cwd="/Users/muki/w/tempo-term/src"
        leafId="leaf1"
        showClose={false}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByRole("button", { name: "w" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "tempo-term" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "src" })).toBeInTheDocument();
  });

  it("lists the segment's subdirectories (dirs only) and cds into the chosen one", async () => {
    fsReadDir.mockResolvedValue([
      { name: "src", path: "/Users/muki/w/tempo-term/src", is_dir: true, size: 0 },
      { name: "my docs", path: "/Users/muki/w/tempo-term/my docs", is_dir: true, size: 0 },
      { name: "README.md", path: "/Users/muki/w/tempo-term/README.md", is_dir: false, size: 1 },
    ]);
    render(
      <TerminalPaneHeader
        cwd="/Users/muki/w/tempo-term/src"
        leafId="leaf1"
        showClose={false}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "tempo-term" }));
    const child = await screen.findByRole("menuitem", { name: "my docs" });
    expect(fsReadDir).toHaveBeenCalledWith("/Users/muki/w/tempo-term");
    expect(screen.queryByRole("menuitem", { name: "README.md" })).toBeNull();

    fireEvent.click(child);
    expect(writeToTerminal).toHaveBeenCalledWith("leaf1", "cd '/Users/muki/w/tempo-term/my docs'\r");
  });

  it("cds back to the segment itself via the menu's head row", async () => {
    fsReadDir.mockResolvedValue([]);
    render(
      <TerminalPaneHeader
        cwd="/Users/muki/w/tempo-term/src"
        leafId="leaf1"
        showClose={false}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "tempo-term" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "tempo-term" }));

    expect(writeToTerminal).toHaveBeenCalledWith("leaf1", "cd /Users/muki/w/tempo-term\r");
  });
});
