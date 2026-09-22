import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiffTabContent } from "./DiffTabContent";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // The count is part of what a label promises, so it has to survive the
    // mock -- a bare key cannot tell "open 20" from "open 23".
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && "count" in vars ? `${key}:${String(vars.count)}` : key,
  }),
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
import { DEFAULT_FONT_SIZE, useFontStore } from "@/stores/fontStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";

describe("DiffTabContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitResolveRepo).mockResolvedValue("/repo");
    useDiffCommentStore.setState({ comments: [] });
    useSessionStatusStore.setState({ statuses: {}, agents: {}, sessionIds: {} });
    // Most tests are not about the one-time hint; dedicated cases flip it back.
    useSettingsStore.setState({ diffCommentHintSeen: true, diffUnified: false });
    useFontStore.setState({ fontSize: DEFAULT_FONT_SIZE });
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

  it("sets the diff type size from the font setting", async () => {
    useFontStore.setState({ fontSize: 20 });
    vi.mocked(gitFileAtRev).mockResolvedValue("old line\n");
    vi.mocked(fsReadFile).mockResolvedValue("new line\n");

    const { container } = render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());
    // The size lands in the theme CodeMirror injects, not on the elements.
    const css = Array.from(document.querySelectorAll("style"))
      .map((tag) => tag.textContent ?? "")
      .join("");
    expect(css).toContain("font-size: 20px");
  });

  it("opens an unchanged stretch by twenty lines, or all of it, on both sides", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
    vi.mocked(gitFileAtRev).mockResolvedValue(lines.join("\n") + "\n");
    vi.mocked(fsReadFile).mockResolvedValue(
      lines.map((line, i) => (i === 29 ? "changed" : line)).join("\n") + "\n",
    );

    const { container } = render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    const bars = () => [...container.querySelectorAll<HTMLElement>(".cm-diff-run")];
    const hidden = () => bars().map((bar) => Number(bar.dataset.lines));
    // Two stretches, above and below the change, one bar each per side.
    await waitFor(() => expect(bars().length).toBe(4));
    // Three lines of context are kept either side of the change, so 26 of the
    // 29 lines above it are hidden and 28 of the 31 below -- 31 because the
    // trailing newline leaves a last, empty line.
    expect(hidden()).toEqual([26, 28, 26, 28]);

    // The last stretch runs to the end of the file, so there is no change
    // below it for a declaration to contain, and no up arrow to press: both
    // would be answering a question nobody asked.
    expect(bars()[1].querySelector(".cm-diff-run-name")).toBeNull();
    expect(
      bars()[1].querySelector<HTMLButtonElement>('[aria-label^="diffRunExpandUp"]')!.disabled,
    ).toBe(true);
    expect(bars()[0].querySelector(".cm-diff-run-name")).toBeTruthy();

    // The first bar is the top of the file, so the arrow that grows the code
    // above it downwards has nothing to grow from and is dead.
    expect(
      bars()[0].querySelector<HTMLButtonElement>('[aria-label^="diffRunExpandDown"]')!.disabled,
    ).toBe(true);

    // Twenty lines at a time, from whichever end was asked for -- the reason
    // the bars are ours rather than the library's, whose bar only ever opens
    // the lot.
    fireEvent.mouseDown(bars()[0].querySelector('[aria-label^="diffRunExpandUp"]')!);
    await waitFor(() => expect(hidden()[0]).toBe(6));
    // And the other side moved with it, or the two would no longer be reading
    // the same stretch.
    expect(hidden()).toEqual([6, 28, 6, 28]);

    // Pressing again would leave four lines hidden behind a bar that takes a
    // row to say so, so the last of them are simply shown.
    fireEvent.mouseDown(bars()[0].querySelector('[aria-label^="diffRunExpandUp"]')!);
    await waitFor(() => expect(bars().length).toBe(2));

    // Opening the lot is the gutter's icon beside the bar rather than a third
    // button on it; the test next door presses that, since jsdom resolves a
    // gutter click by coordinate and every click lands on the first block.


  });

  it("folds an opened stretch back up from the gutter", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    vi.mocked(gitFileAtRev).mockResolvedValue(lines.join("\n") + "\n");
    vi.mocked(fsReadFile).mockResolvedValue(
      lines.map((line, i) => (i === 9 ? "changed" : line)).join("\n") + "\n",
    );

    const { container } = render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    const bars = () => container.querySelectorAll(".cm-diff-run").length;
    const backs = () => container.querySelectorAll(".cm-diff-fold");
    await waitFor(() => expect(bars()).toBe(4));

    // jsdom has no layout, so a gutter click carries no usable coordinate and
    // the view resolves every one to the first block. That is the first bar
    // here, which is the one this test is about.

    // Opened all the way, a stretch leaves no bar behind, so the way back has
    // to live somewhere else: the gutter grows a fold icon on its first line.
    fireEvent.mouseDown(container.querySelector(".cm-diff-unfold")!);
    await waitFor(() => expect(bars()).toBe(2));
    await waitFor(() => expect(backs().length).toBe(2));

    fireEvent.mouseDown(backs()[0]);
    await waitFor(() => expect(bars()).toBe(4));
    expect(backs().length).toBe(0);
  });

  it("folds an opened stretch back up inline too", async () => {
    // One editor rather than two, so every count here is half the split
    // case's -- and the gutter the way back lives in is a different gutter.
    // The pane had a test for this before the bars were ours; it went with
    // the library's class name and was not replaced.
    useSettingsStore.setState({ diffUnified: true });
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    vi.mocked(gitFileAtRev).mockResolvedValue(lines.join("\n") + "\n");
    vi.mocked(fsReadFile).mockResolvedValue(
      lines.map((line, i) => (i === 9 ? "changed" : line)).join("\n") + "\n",
    );

    const { container } = render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    const bars = () => container.querySelectorAll(".cm-diff-run").length;
    const backs = () => container.querySelectorAll(".cm-diff-fold");
    await waitFor(() => expect(bars()).toBe(2));

    fireEvent.mouseDown(container.querySelector(".cm-diff-unfold")!);
    await waitFor(() => expect(bars()).toBe(1));
    await waitFor(() => expect(backs().length).toBe(1));

    fireEvent.mouseDown(backs()[0]);
    await waitFor(() => expect(bars()).toBe(2));
    expect(backs().length).toBe(0);
  });

  it("promises the number of lines the press will actually open", async () => {
    // Twenty-three hidden: a step of twenty would leave three behind a bar
    // that takes a row of its own to say so, so the press opens all of them.
    // The label has to say twenty-three, or it undercounts what it does.
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    vi.mocked(gitFileAtRev).mockResolvedValue(lines.join("\n") + "\n");
    vi.mocked(fsReadFile).mockResolvedValue(
      lines.map((line, i) => (i === 26 ? "changed" : line)).join("\n") + "\n",
    );

    const { container } = render(<DiffTabContent path="/repo/a.ts" staged={false} />);
    const bar = () => container.querySelector<HTMLElement>(".cm-diff-run")!;
    await waitFor(() => expect(bar()).toBeTruthy());

    const hidden = Number(bar().dataset.lines);
    expect(hidden).toBe(23);
    expect(
      bar().querySelector('[aria-label^="diffRunExpandUp"]')!.getAttribute("aria-label"),
    ).toBe(`diffRunExpandUp:${hidden}`);

    fireEvent.mouseDown(bar().querySelector('[aria-label^="diffRunExpandUp"]')!);
    // And it opened the lot, which is what the label had just promised.
    await waitFor(() => expect(container.querySelector(".cm-diff-run")).toBeNull());
  });

  it("names the declaration the hidden lines lead into", async () => {
    const before = [
      "use std::fmt;",
      "",
      "fn build_log_refs() -> Vec<String> {",
      ...Array.from({ length: 30 }, (_, i) => `    let x${i} = ${i};`),
      "    let tail = 1;",
      "}",
    ];
    vi.mocked(gitFileAtRev).mockResolvedValue(before.join("\n") + "\n");
    vi.mocked(fsReadFile).mockResolvedValue(
      before.map((line) => (line === "    let tail = 1;" ? "    let tail = 999;" : line)).join("\n") +
        "\n",
    );

    const { container } = render(<DiffTabContent path="/repo/a.rs" staged={false} />);

    // What GitHub puts after the `@@`, and what the library's bar has no room
    // to say: the changes under this bar are inside this declaration.
    await waitFor(() => expect(container.querySelectorAll(".cm-diff-run").length).toBe(2));
    // One bar each side of the split, and both have to say it: the two are
    // the same stretch of the same file, and a name on one of them only would
    // read as a difference between the sides.
    expect(
      [...container.querySelectorAll(".cm-diff-run")].map((el) => el.textContent),
    ).toEqual([
      "diffUnchangedLinesfn build_log_refs() -> Vec<String> ",
      "diffUnchangedLinesfn build_log_refs() -> Vec<String> ",
    ]);
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
