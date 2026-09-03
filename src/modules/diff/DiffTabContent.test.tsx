import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiffTabContent } from "./DiffTabContent";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // tabsStore transitively pulls in the real i18n init, which registers this
  // plugin object during module load.
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/modules/source-control/lib/gitBridge", () => ({
  gitResolveRepo: vi.fn(),
  gitFileAtRev: vi.fn(),
}));

vi.mock("@/modules/explorer/lib/fsBridge", () => ({
  fsReadFile: vi.fn(),
}));

vi.mock("@/modules/terminal/lib/terminalBus", () => ({
  pasteToTerminal: vi.fn(),
}));

import { gitFileAtRev, gitResolveRepo } from "@/modules/source-control/lib/gitBridge";
import { fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { pasteToTerminal } from "@/modules/terminal/lib/terminalBus";
import { useDiffCommentStore } from "./lib/diffCommentStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";

describe("DiffTabContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitResolveRepo).mockResolvedValue("/repo");
    useDiffCommentStore.setState({ comments: [] });
    useSessionStatusStore.setState({ statuses: {}, agents: {}, sessionIds: {} });
    // Most tests are not about the one-time hint; dedicated cases flip it back.
    useSettingsStore.setState({ diffCommentHintSeen: true, diffUnified: false });
  });

  it("compares index vs working tree for an unstaged diff", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("old\n");
    vi.mocked(fsReadFile).mockResolvedValue("new\n");

    render(<DiffTabContent path="/repo/src/a.ts" staged={false} />);

    await waitFor(() =>
      expect(gitFileAtRev).toHaveBeenCalledWith("/repo", ":", "src/a.ts"),
    );
    expect(fsReadFile).toHaveBeenCalledWith("/repo/src/a.ts");
    expect(screen.getByText("diffUnstaged")).toBeInTheDocument();
  });

  it("compares HEAD vs index for a staged diff", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("x\n");

    render(<DiffTabContent path="/repo/a.ts" staged={true} />);

    await waitFor(() => expect(gitFileAtRev).toHaveBeenCalledTimes(2));
    expect(gitFileAtRev).toHaveBeenCalledWith("/repo", "HEAD", "a.ts");
    expect(gitFileAtRev).toHaveBeenCalledWith("/repo", ":", "a.ts");
    expect(fsReadFile).not.toHaveBeenCalled();
    expect(screen.getByText("diffStaged")).toBeInTheDocument();
  });

  it("treats an unreadable working file as empty (deleted file)", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("was here\n");
    vi.mocked(fsReadFile).mockRejectedValue(new Error("gone"));

    render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    await waitFor(() => expect(fsReadFile).toHaveBeenCalled());
    // No error surface — the diff simply renders against an empty right side.
    expect(screen.queryByText("diffLoadError")).not.toBeInTheDocument();
  });

  it("folds the pane close button into the header row", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("x\n");
    vi.mocked(fsReadFile).mockResolvedValue("y\n");
    const onClose = vi.fn();
    render(<DiffTabContent path="/repo/a.ts" staged={false} showClose onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "workspace.closePane" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("switches the diff between side-by-side and inline", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("old line\n");
    vi.mocked(fsReadFile).mockResolvedValue("new line\n");

    const { container } = render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "diffInlineView" }));

    expect(useSettingsStore.getState().diffUnified).toBe(true);
    // The control now offers the way back.
    expect(screen.getByRole("button", { name: "diffSplitView" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "diffInlineView" })).toBeNull();
    // Inline drops the two-editor container for a single editor holding the
    // new document, with the old lines rendered in as deletion widgets.
    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeNull());
    expect(container.querySelector(".diff-inline-view .cm-editor")).toBeTruthy();
    expect(container.querySelector(".cm-deletedChunk")).toBeTruthy();
  });

  it("folds expanded unchanged regions back up", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    vi.mocked(gitFileAtRev).mockResolvedValue(lines.join("\n") + "\n");
    vi.mocked(fsReadFile).mockResolvedValue(
      lines.map((line, i) => (i === 9 ? "changed" : line)).join("\n") + "\n",
    );

    const { container } = render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    const bars = () => container.querySelectorAll(".cm-collapsedLines").length;
    const backs = () => container.querySelectorAll(".cm-diff-fold");
    // Two unchanged stretches (above and below the change), one bar each per
    // side of the diff.
    await waitFor(() => expect(bars()).toBe(4));

    // Expanding a stretch is one-way in the library: the bar is consumed. The
    // gutter's unfold icon opens both sides at once, same as the bar does.
    expect(container.querySelectorAll(".cm-diff-unfold").length).toBe(4);
    fireEvent.mouseDown(container.querySelector(".cm-diff-unfold")!);
    await waitFor(() => expect(bars()).toBe(2));
    fireEvent.click(container.querySelector(".cm-collapsedLines")!);
    await waitFor(() => expect(bars()).toBe(0));

    // Each expanded stretch grows its own fold-back bar where the old one
    // was, and folding one leaves the other open.
    await waitFor(() => expect(backs().length).toBe(4));
    fireEvent.mouseDown(backs()[0]);
    await waitFor(() => expect(bars()).toBe(2));
    expect(backs().length).toBe(2);
  });

  it("folds expanded unchanged regions back up inline too", async () => {
    useSettingsStore.setState({ diffUnified: true });
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    vi.mocked(gitFileAtRev).mockResolvedValue(lines.join("\n") + "\n");
    vi.mocked(fsReadFile).mockResolvedValue(
      lines.map((line, i) => (i === 9 ? "changed" : line)).join("\n") + "\n",
    );

    const { container } = render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    const bars = () => container.querySelectorAll(".cm-collapsedLines").length;
    await waitFor(() => expect(bars()).toBeGreaterThan(0));
    const collapsed = bars();

    fireEvent.click(container.querySelector(".cm-collapsedLines")!);
    await waitFor(() => expect(bars()).toBeLessThan(collapsed));

    // The expanded stretch grows a fold control in its own gutter, on the
    // first line it revealed.
    const back = container.querySelector(".cm-diff-fold");
    expect(back).toBeTruthy();
    fireEvent.mouseDown(back!);
    await waitFor(() => expect(bars()).toBe(collapsed));
    expect(container.querySelector(".cm-diff-fold")).toBeNull();
  });

  it("renders a saved review comment as a card inside the diff", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("old line\n");
    vi.mocked(fsReadFile).mockResolvedValue("new line\n");
    useDiffCommentStore.getState().add({
      path: "/repo/a.ts",
      staged: false,
      side: "b",
      line: 1,
      lineText: "new line",
      body: "please rename",
    });

    render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    await waitFor(() => expect(screen.getByText("please rename")).toBeInTheDocument());
  });

  it("disables the send button when every comment is already sent", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("x\n");
    vi.mocked(fsReadFile).mockResolvedValue("y\n");

    render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "diffSendToAgent" })).toBeDisabled(),
    );
  });

  it("batch-sends unsent comments to the picked agent pane and marks them sent", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("old\n");
    vi.mocked(fsReadFile).mockResolvedValue("new\n");
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Salon" }],
      activeSpaceId: "s1",
      activeId: "t9",
      tabs: [
        {
          id: "t1",
          spaceId: "s1",
          title: "agent-tab",
          kind: "terminal",
          paneTree: leaf("p1", { kind: "terminal", cwd: "/repo" }),
          activeLeafId: "p1",
          paneOrder: ["p1"],
        },
      ],
    });
    useSessionStatusStore.setState({
      statuses: { p1: "active" },
      agents: { p1: "claude" },
      sessionIds: {},
    });
    useDiffCommentStore.getState().add({
      path: "/repo/a.ts",
      staged: false,
      side: "b",
      line: 1,
      lineText: "new",
      body: "tighten this up",
    });

    render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    fireEvent.click(screen.getByRole("button", { name: "diffSendToAgent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Claude · agent-tab/ }));

    expect(pasteToTerminal).toHaveBeenCalledTimes(1);
    const [leafId, prompt] = vi.mocked(pasteToTerminal).mock.calls[0];
    expect(leafId).toBe("p1");
    expect(prompt).toContain("## /repo/a.ts");
    expect(prompt).toContain("tighten this up");
    expect(useDiffCommentStore.getState().comments[0].sent).toBe(true);
    // The picked pane's tab becomes active so the user can review and submit.
    expect(useTabsStore.getState().activeId).toBe("t1");
  });

  it("shows the one-time comment hint on first open and dismisses it for good", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("x\n");
    vi.mocked(fsReadFile).mockResolvedValue("y\n");
    useSettingsStore.setState({ diffCommentHintSeen: false });

    render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    expect(screen.getByText("diffCommentHintTitle")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "diffCommentHintDismiss" }));
    expect(screen.queryByText("diffCommentHintTitle")).not.toBeInTheDocument();
    expect(useSettingsStore.getState().diffCommentHintSeen).toBe(true);
  });

  it("keeps the hint hidden once it was seen", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("x\n");
    vi.mocked(fsReadFile).mockResolvedValue("y\n");

    render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    await waitFor(() => expect(screen.getByText("diffUnstaged")).toBeInTheDocument());
    expect(screen.queryByText("diffCommentHintTitle")).not.toBeInTheDocument();
  });

  it("shows a disabled hint when no agent session is running", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("old\n");
    vi.mocked(fsReadFile).mockResolvedValue("new\n");
    useDiffCommentStore.getState().add({
      path: "/repo/a.ts",
      staged: false,
      side: "b",
      line: 1,
      lineText: "new",
      body: "note",
    });

    render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    fireEvent.click(screen.getByRole("button", { name: "diffSendToAgent" }));
    expect(await screen.findByRole("menuitem", { name: "diffNoAgentSession" })).toBeDisabled();
  });

  it("diffs a big file precisely when its changes are scattered", async () => {
    // @codemirror/merge's default diff config gives up on a differing range
    // past a few thousand characters and marks the whole of it as replaced.
    // What trips it is not size alone but changes spread out inside one — a
    // resource file with lines added in four places used to render as the
    // entire file deleted and added back. 600 lines with four insertion
    // points is the smallest shape that reproduces it (31 lines falsely
    // marked deleted before this change).
    const base = Array.from(
      { length: 600 },
      (_, i) => `    const value${i} = computeSomething(${i}, "an argument");`,
    );
    const insertAt = new Set([120, 240, 360, 480]);
    const withAdditions: string[] = [];
    base.forEach((line, i) => {
      if (insertAt.has(i)) {
        withAdditions.push("    const brandNew = 1;", "    const alsoNew = 2;");
      }
      withAdditions.push(line);
    });
    vi.mocked(gitFileAtRev).mockResolvedValue(base.join("\n") + "\n");
    vi.mocked(fsReadFile).mockResolvedValue(withAdditions.join("\n") + "\n");

    const { container } = render(<DiffTabContent path="/repo/big.ts" staged={false} />);

    await waitFor(() =>
      expect(container.querySelectorAll(".cm-merge-b .cm-changedLine").length).toBeGreaterThan(0),
    );
    // Nothing was removed, so the old side carries no changed line at all.
    expect(container.querySelectorAll(".cm-merge-a .cm-changedLine").length).toBe(0);
  });
});
