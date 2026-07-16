import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { gitWorktreeAdd, gitWorktreeListDetailed, gitWorktreeDiskSize } = vi.hoisted(() => ({
  gitWorktreeAdd: vi.fn(),
  gitWorktreeListDetailed: vi.fn(),
  gitWorktreeDiskSize: vi.fn(),
}));
vi.mock("./lib/worktreesBridge", () => ({
  gitWorktreeAdd,
  gitWorktreeListDetailed,
  gitWorktreeDiskSize,
}));

import "@/i18n";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import { useTabsStore } from "@/stores/tabsStore";
import { useWorktreeSettingsStore } from "@/stores/worktreeSettingsStore";
import { useWorktreesStore } from "./lib/worktreesStore";
import { CreateWorktreeForm } from "./CreateWorktreeForm";

const REPO = "/code/app";

beforeEach(() => {
  vi.clearAllMocks();
  gitWorktreeListDetailed.mockResolvedValue([]);
  useWorktreesStore.setState({ byRepo: {}, sizes: {} });
  useWorktreeSettingsStore.setState({ byRepo: {} });
  useTabsStore.setState({
    tabs: [],
    activeId: null,
    spaces: [{ id: "s1", name: "S" }],
    activeSpaceId: "s1",
  });
});

const nameInput = () => screen.getByRole("textbox");
const createButton = () => screen.getByRole("button", { name: /create/i });

function terminalCwds(): string[] {
  return useTabsStore
    .getState()
    .tabs.flatMap((t) =>
      computeLayout(t.paneTree)
        .filter((p) => p.content?.kind === "terminal")
        .map((p) => (p.content as { cwd?: string }).cwd ?? ""),
    );
}

describe("CreateWorktreeForm", () => {
  it("shows where the worktree will land before anything is created", () => {
    render(<CreateWorktreeForm repoPath={REPO} onDone={vi.fn()} />);

    fireEvent.change(nameInput(), { target: { value: "feat/x" } });

    expect(screen.getByText("/code/app-worktrees/feat-x")).toBeInTheDocument();
  });

  it("follows the container the user chose for this repo", () => {
    useWorktreeSettingsStore.setState({ byRepo: { [REPO]: { containerPath: "/scratch/trees" } } });

    render(<CreateWorktreeForm repoPath={REPO} onDone={vi.fn()} />);
    fireEvent.change(nameInput(), { target: { value: "feat/x" } });

    expect(screen.getByText("/scratch/trees/feat-x")).toBeInTheDocument();
  });

  it("will not create without a name", () => {
    render(<CreateWorktreeForm repoPath={REPO} onDone={vi.fn()} />);

    expect(createButton()).toBeDisabled();
  });

  it("says why a name git would refuse will not do, while it is being typed", () => {
    render(<CreateWorktreeForm repoPath={REPO} onDone={vi.fn()} />);

    fireEvent.change(nameInput(), { target: { value: "feat x" } });

    expect(createButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("creates the worktree and opens a terminal in it", async () => {
    gitWorktreeAdd.mockResolvedValue({ path: "/code/app-worktrees/feat-x", branch: "feat/x" });
    const onDone = vi.fn();

    render(<CreateWorktreeForm repoPath={REPO} onDone={onDone} />);
    fireEvent.change(nameInput(), { target: { value: "feat/x" } });
    fireEvent.click(createButton());

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(gitWorktreeAdd).toHaveBeenCalledWith(
      REPO,
      "/code/app-worktrees/feat-x",
      "feat/x",
      true,
      undefined,
    );
    // Opens where git says it landed, not where we guessed it would.
    expect(terminalCwds()).toContain("/code/app-worktrees/feat-x");
  });

  it("shows git's own complaint and stays put when the add fails", async () => {
    gitWorktreeAdd.mockRejectedValue("branch already exists: feat/x");
    const onDone = vi.fn();

    render(<CreateWorktreeForm repoPath={REPO} onDone={onDone} />);
    fireEvent.change(nameInput(), { target: { value: "feat/x" } });
    fireEvent.click(createButton());

    expect(await screen.findByText(/branch already exists/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it("cannot be submitted twice while git is still working", async () => {
    let release: (v: unknown) => void = () => {};
    gitWorktreeAdd.mockReturnValue(new Promise((r) => (release = r)));

    render(<CreateWorktreeForm repoPath={REPO} onDone={vi.fn()} />);
    fireEvent.change(nameInput(), { target: { value: "feat/x" } });
    fireEvent.click(createButton());

    await waitFor(() => expect(createButton()).toBeDisabled());
    fireEvent.click(createButton());

    expect(gitWorktreeAdd).toHaveBeenCalledTimes(1);
    release({ path: "/code/app-worktrees/feat-x", branch: "feat/x" });
  });
});
