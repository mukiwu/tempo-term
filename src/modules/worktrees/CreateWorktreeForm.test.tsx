import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { gitWorktreeAdd, gitWorktreeListDetailed, gitWorktreeDiskSize, gitWorktreeCopyLocalFiles } =
  vi.hoisted(() => ({
    gitWorktreeAdd: vi.fn(),
    gitWorktreeListDetailed: vi.fn(),
    gitWorktreeDiskSize: vi.fn(),
    gitWorktreeCopyLocalFiles: vi.fn(),
  }));

const { writeToTerminal } = vi.hoisted(() => ({ writeToTerminal: vi.fn() }));
vi.mock("@/modules/terminal/lib/terminalBus", () => ({ writeToTerminal }));
vi.mock("./lib/worktreesBridge", () => ({
  gitWorktreeAdd,
  gitWorktreeListDetailed,
  gitWorktreeDiskSize,
  gitWorktreeCopyLocalFiles,
  gitWorktreeRemove: vi.fn(),
  gitWorktreePrune: vi.fn(),
}));

import "@/i18n";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import { useTabsStore } from "@/stores/tabsStore";
import { useNotifyStore } from "@/stores/notifyStore";
import { useWorktreeSettingsStore } from "@/stores/worktreeSettingsStore";
import { useWorktreesStore } from "./lib/worktreesStore";
import { CreateWorktreeForm } from "./CreateWorktreeForm";

const REPO = "/code/app";

beforeEach(() => {
  vi.clearAllMocks();
  gitWorktreeListDetailed.mockResolvedValue([]);
  gitWorktreeCopyLocalFiles.mockResolvedValue([]);
  useWorktreesStore.setState({ byRepo: {}, sizes: {} });
  useWorktreeSettingsStore.setState({ byRepo: {} });
  useTabsStore.setState({
    tabs: [],
    activeId: null,
    spaces: [{ id: "s1", name: "S" }],
    activeSpaceId: "s1",
  });
});

const nameInput = () => screen.getByLabelText(/branch name/i);
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

  it("copies the local files before the shell that will read them starts", async () => {
    // A setup command like `pnpm install` reads .env. A shell that started
    // first would race the copy, and lose in a way that only shows up
    // sometimes.
    const order: string[] = [];
    gitWorktreeAdd.mockResolvedValue({ path: "/code/app-worktrees/feat-x", branch: "feat/x" });
    gitWorktreeCopyLocalFiles.mockImplementation(() => {
      order.push("copy");
      return Promise.resolve([".env"]);
    });
    writeToTerminal.mockImplementation(() => order.push("write"));

    render(<CreateWorktreeForm repoPath={REPO} onDone={vi.fn()} />);
    fireEvent.change(nameInput(), { target: { value: "feat/x" } });
    fireEvent.change(screen.getByLabelText(/run after creating/i), {
      target: { value: "pnpm install" },
    });
    fireEvent.click(createButton());

    await waitFor(() => expect(writeToTerminal).toHaveBeenCalled());
    expect(order).toEqual(["copy", "write"]);
    expect(gitWorktreeCopyLocalFiles).toHaveBeenCalledWith(REPO, "/code/app-worktrees/feat-x", [
      "**/.env*",
    ]);
  });

  it("runs setup and the agent as one line, so the agent waits for setup to work", async () => {
    gitWorktreeAdd.mockResolvedValue({ path: "/code/app-worktrees/feat-x", branch: "feat/x" });

    render(<CreateWorktreeForm repoPath={REPO} onDone={vi.fn()} />);
    fireEvent.change(nameInput(), { target: { value: "feat/x" } });
    fireEvent.change(screen.getByLabelText(/run after creating/i), {
      target: { value: "pnpm install" },
    });
    fireEvent.click(createButton());

    await waitFor(() => expect(writeToTerminal).toHaveBeenCalled());
    // CR, not LF: Windows' PSReadLine reads LF as a continuation that never
    // submits, so an LF here would leave the command sitting at a `>>` prompt.
    expect(writeToTerminal).toHaveBeenCalledWith(expect.any(String), "pnpm install\r");
  });

  it("remembers this repo's setup command for the next worktree", async () => {
    gitWorktreeAdd.mockResolvedValue({ path: "/code/app-worktrees/feat-x", branch: "feat/x" });

    render(<CreateWorktreeForm repoPath={REPO} onDone={vi.fn()} />);
    fireEvent.change(nameInput(), { target: { value: "feat/x" } });
    fireEvent.change(screen.getByLabelText(/run after creating/i), {
      target: { value: "pnpm install" },
    });
    fireEvent.click(createButton());

    await waitFor(() =>
      expect(useWorktreeSettingsStore.getState().byRepo[REPO]?.setupCommand).toBe("pnpm install"),
    );
  });

  it("does not hold the user in a dialog they cannot get out of when only the copy failed", async () => {
    // The worktree is on disk and its terminal is open. Keeping the form up with
    // an error means the only thing left to click is Create, which now dies on
    // "branch already exists" — the same trap as reporting a failed rescan.
    gitWorktreeAdd.mockResolvedValue({ path: "/code/app-worktrees/feat-x", branch: "feat/x" });
    gitWorktreeCopyLocalFiles.mockRejectedValue("permission denied");
    const onDone = vi.fn();

    render(<CreateWorktreeForm repoPath={REPO} onDone={onDone} />);
    fireEvent.change(nameInput(), { target: { value: "feat/x" } });
    fireEvent.click(createButton());

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // Said out loud rather than swallowed: an agent that needs .env will fail
    // without it, and the user has to know why.
    expect(useNotifyStore.getState().notice?.text).toMatch(/permission denied/);
    expect(terminalCwds()).toContain("/code/app-worktrees/feat-x");
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
