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
    useWorkspaceStore.setState({ rootPath: "/Users/muki/w/tempo-term" });
  });

  it("shows workspace-relative crumbs for the pane's cwd", () => {
    render(
      <TerminalPaneHeader
        cwd="/Users/muki/w/tempo-term/src"
        leafId="leaf1"
        showClose={false}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "tempo-term" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "src" })).toBeInTheDocument();
  });

  it("lists only sibling directories and cds into the chosen one", async () => {
    fsReadDir.mockResolvedValue([
      { name: "tempo-term", path: "/Users/muki/w/tempo-term", is_dir: true, size: 0 },
      { name: "other proj", path: "/Users/muki/w/other proj", is_dir: true, size: 0 },
      { name: "README.md", path: "/Users/muki/w/README.md", is_dir: false, size: 1 },
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
    const sibling = await screen.findByRole("menuitem", { name: "other proj" });
    expect(fsReadDir).toHaveBeenCalledWith("/Users/muki/w");
    expect(screen.queryByRole("menuitem", { name: "README.md" })).toBeNull();

    fireEvent.click(sibling);
    expect(writeToTerminal).toHaveBeenCalledWith("leaf1", "cd '/Users/muki/w/other proj'\r");
  });
});
