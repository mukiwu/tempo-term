import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AllChangesTabContent } from "./AllChangesTabContent";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      for (const slot of ["count", "name"]) {
        if (vars && slot in vars) {
          return `${key}:${String(vars[slot])}`;
        }
      }
      return key;
    },
  }),
  // tabsStore transitively pulls in the real i18n init, which registers this
  // plugin object during module load.
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/modules/source-control/lib/gitBridge", () => ({
  gitResolveRepo: vi.fn(),
  gitResolveRev: vi.fn(),
  gitStatus: vi.fn(),
  gitDiff: vi.fn(),
  gitDiffFromBase: vi.fn(),
  gitFileAtRev: vi.fn(),
}));

vi.mock("@/modules/explorer/lib/fsBridge", () => ({
  fsReadFile: vi.fn(),
}));

vi.mock("@/modules/terminal/lib/terminalBus", () => ({
  pasteToTerminal: vi.fn(),
}));

import {
  gitDiff,
  gitDiffFromBase,
  gitFileAtRev,
  gitResolveRepo,
  gitResolveRev,
  gitStatus,
} from "@/modules/source-control/lib/gitBridge";
import { fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDiffCommentStore } from "./lib/diffCommentStore";
import { useAllChangesLinkStore } from "./lib/allChangesLinkStore";
import { useComparisonBaseStore } from "./lib/comparisonBaseStore";

/**
 * The n/N counter, whichever numbers it holds. Its left-hand number is read
 * off the scroll position and jsdom has no layout to have one, so tests assert
 * the total and the stepping rather than an absolute position.
 */
const counter = (total: number) =>
  screen.getByText((text) => /^\d+\/\d+$/.test(text) && text.endsWith(`/${total}`));

/** A one-hunk diff for `path`, three lines added and one taken away. */
function diffFor(path: string) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,2 +1,4 @@",
    " keep",
    "-gone",
    "+one",
    "+two",
    "+three",
    "",
  ].join("\n");
}

/** The pane the tests mount their page into. */
const PANE = "leaf-1";

describe("AllChangesTabContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ rootPath: "/repo" });
    useDiffCommentStore.setState({ comments: [] });
    useSettingsStore.setState({ diffUnified: false });
    useAllChangesLinkStore.setState({ file: {}, showing: {}, rescan: {}, listing: {} });
    // Session state, so a base one test picks would otherwise be the base
    // every test after it starts from.
    useComparisonBaseStore.setState({ byRepo: {}, includeUncommitted: true });
    vi.mocked(gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitDiff).mockResolvedValue("");
    vi.mocked(gitResolveRev).mockResolvedValue("1111111");
    vi.mocked(gitFileAtRev).mockResolvedValue("");
    vi.mocked(fsReadFile).mockResolvedValue("");
    vi.mocked(gitStatus).mockResolvedValue({ branch: "main", staged: [], unstaged: [] });
  });

  it("scans both sides and stacks a section per changed file", async () => {
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [{ path: "src/a.ts", staged: true, status: "M" }],
      unstaged: [{ path: "src/b.ts", staged: false, status: "M" }],
    });
    vi.mocked(gitDiff).mockImplementation(async (_repo, staged) =>
      staged ? diffFor("src/a.ts") : diffFor("src/b.ts"),
    );
    vi.mocked(gitFileAtRev).mockResolvedValue("keep\ngone\n");
    vi.mocked(fsReadFile).mockResolvedValue("keep\none\ntwo\nthree\n");

    const { container } = render(<AllChangesTabContent paneId={PANE} />);

    // One scan per side: `git diff` compares against one of them, never both.
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(2));
    expect(gitDiff).toHaveBeenCalledWith("/repo", true);
    expect(gitDiff).toHaveBeenCalledWith("/repo", false);

    await waitFor(() =>
      expect(container.querySelectorAll("[data-diff-file]").length).toBe(2),
    );
    expect(container.querySelector('[data-diff-file="s:src/a.ts"]')).toBeTruthy();
    expect(container.querySelector('[data-diff-file="w:src/b.ts"]')).toBeTruthy();
    // Both groups are labelled, matching the panel's own two sections.
    expect(screen.getByText("stagedChanges")).toBeInTheDocument();
    expect(screen.getByText("changes")).toBeInTheDocument();
    // The counts come from the scan, with no editor involved.
    expect(screen.getAllByText("+3").length).toBe(2);
    expect(screen.getAllByText("−1").length).toBe(2);
    // A header leads with the file's own name and trails the folder it is in.
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
    expect(screen.getAllByText("src").length).toBe(2);
    // And the pane header carries the size of the whole change, which is the
    // one thing a list of file names never says.
    expect(screen.getByText("+6")).toBeInTheDocument();
    expect(screen.getByText("−2")).toBeInTheDocument();
    expect(screen.getByText("allChangesFileCount:2")).toBeInTheDocument();
  });

  it("stacks the files the way the panel's tree draws them", async () => {
    // Status reports these in its own order; a directory's changes belong
    // together, and the panel lists them folders-first so this page has to as
    // well or it is not the same index twice.
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [
        { path: "root-b.md", staged: false, status: "M" },
        { path: "src/zeta.ts", staged: false, status: "M" },
        { path: "root-a.md", staged: false, status: "M" },
        { path: "src/alpha.ts", staged: false, status: "M" },
      ],
    });

    const { container } = render(<AllChangesTabContent paneId={PANE} />);

    await waitFor(() =>
      expect(container.querySelectorAll("[data-diff-file]").length).toBe(4),
    );
    expect(
      Array.from(container.querySelectorAll("[data-diff-file]")).map((el) =>
        el.getAttribute("data-diff-file"),
      ),
    ).toEqual(["w:src/alpha.ts", "w:src/zeta.ts", "w:root-a.md", "w:root-b.md"]);
  });

  it("reads each file the way the single-file tab does", async () => {
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [{ path: "a.ts", staged: true, status: "M" }],
      unstaged: [{ path: "b.ts", staged: false, status: "M" }],
    });

    render(<AllChangesTabContent paneId={PANE} />);

    // Staged: HEAD against the index. Working tree: the index against the file.
    await waitFor(() => expect(gitFileAtRev).toHaveBeenCalledWith("/repo", "HEAD", "a.ts"));
    expect(gitFileAtRev).toHaveBeenCalledWith("/repo", ":", "a.ts");
    expect(gitFileAtRev).toHaveBeenCalledWith("/repo", ":", "b.ts");
    expect(fsReadFile).toHaveBeenCalledWith("/repo/b.ts");
  });

  it("shows an untracked file as one whole addition", async () => {
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [{ path: "new.ts", staged: false, status: "?" }],
    });
    // git diff never reports an untracked file, so it has no scan entry; its
    // index side comes back empty and the working copy is the whole change.
    vi.mocked(gitFileAtRev).mockResolvedValue("");
    vi.mocked(fsReadFile).mockResolvedValue("one\ntwo\n");

    const { container } = render(<AllChangesTabContent paneId={PANE} />);

    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());
    // Counted off the documents, since the scan had nothing to say about it —
    // and reported up, so the page total covers it too.
    const section = container.querySelector<HTMLElement>('[data-diff-file="w:new.ts"]');
    expect(within(section!).getByText("+2")).toBeInTheDocument();
    expect(within(section!).getByText("−0")).toBeInTheDocument();
    // Awaited, not asserted outright: the page total is not measured here but
    // reported up by the section that measured it, so it lands a render after
    // the section's own number and after the merge view this test waited for.
    await waitFor(() => expect(screen.getAllByText("+2").length).toBe(2));
  });

  it("folds a file that changes more lines than the page can carry", async () => {
    const huge = Array.from({ length: 600 }, (_, i) => `+line ${i}`);
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [{ path: "pnpm-lock.yaml", staged: false, status: "M" }],
    });
    vi.mocked(gitDiff).mockImplementation(async (_repo, staged) =>
      staged
        ? ""
        : [
            "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
            "--- a/pnpm-lock.yaml",
            "+++ b/pnpm-lock.yaml",
            "@@ -1,1 +1,601 @@",
            " keep",
            ...huge,
            "",
          ].join("\n"),
    );

    const { container } = render(<AllChangesTabContent paneId={PANE} />);

    await waitFor(() => expect(screen.getByText("allChangesFolded:500")).toBeInTheDocument());
    // Folded means not read at all: no documents fetched, no editors built.
    expect(container.querySelector(".cm-mergeView")).toBeNull();
    expect(gitFileAtRev).not.toHaveBeenCalled();

    // It carries no button of its own: the header opens it, like any file.
    fireEvent.click(screen.getByRole("button", { name: new RegExp("^allChangesExpandFile") }));

    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());
    // And the reason goes with the fold — the file is no longer shut by a rule.
    expect(screen.queryByText("allChangesFolded:500")).toBeNull();
  });

  it("shuts a file the reader has finished with, and its changes with it", async () => {
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [{ path: "src/a.ts", staged: false, status: "M" }],
    });
    vi.mocked(gitDiff).mockImplementation(async (_repo, staged) =>
      staged ? "" : diffFor("src/a.ts"),
    );

    const { container } = render(<AllChangesTabContent paneId={PANE} />);

    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());
    expect(counter(1)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: new RegExp("^allChangesCollapseFile") }));

    // The editors go, and so does the file's hunk in the page's navigation —
    // there is nothing on screen left to land on.
    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeNull());
    // Nothing left to navigate, so the counter itself is gone.
    expect(screen.queryByText(/^\d+\/1$/)).toBeNull();
    // The header still reads, counts and all — and the counts are part of the
    // same target, so there is no dead strip along the right of the row.
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    const header = screen.getByRole("button", { name: new RegExp("^allChangesExpandFile") });
    expect(within(header).getByText("+3")).toBeInTheDocument();
    expect(within(header).getByText("−1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: new RegExp("^allChangesExpandFile") }));
    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());
  });

  it("keeps the header in view when a file is shut from half way down it", async () => {
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [
        { path: "src/a.ts", staged: false, status: "M" },
        { path: "src/b.ts", staged: false, status: "M" },
        { path: "src/c.ts", staged: false, status: "M" },
      ],
    });
    vi.mocked(gitDiff).mockImplementation(async (_repo, staged) =>
      staged ? "" : diffFor("src/a.ts") + diffFor("src/b.ts") + diffFor("src/c.ts"),
    );

    const { container } = render(<AllChangesTabContent paneId={PANE} />);
    // Wait for the editors, not just the sections: the page registers the
    // handles it measures against as they are built.
    await waitFor(() => expect(container.querySelectorAll(".cm-mergeView").length).toBe(3));

    // jsdom lays nothing out, so the geometry the page reads is stubbed. The
    // middle file is the one being shut -- there is a whole file above it, so
    // the arithmetic is not clamped at the top of the page and a few pixels
    // out would show. Its header starts 1,000px down and the reader is
    // 2,000px into it, which is to say its header is above the viewport and
    // its sticky copy is what they can actually see.
    const root = container.querySelector<HTMLElement>(".overflow-auto")!;
    let scrollTop = 3000;
    Object.defineProperty(root, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
    });
    root.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const middle = container.querySelector<HTMLElement>('[data-diff-file="w:src/b.ts"]')!;
    middle.getBoundingClientRect = () => ({ top: 1000 - scrollTop }) as DOMRect;

    fireEvent.click(within(middle).getByRole("button", { name: new RegExp("^allChangesCollapseFile") }));

    // Without the pin the page stays at 3,000 and the reader is left in
    // whatever file has moved up into that position. The header goes to the
    // very top of the pane, not to the gap navigation leaves: it is sticky and
    // has been sitting there all along, so any offset reads as a flinch.
    await waitFor(() => expect(scrollTop).toBe(1000));
    expect(middle.getBoundingClientRect().top).toBeCloseTo(0);
  });

  it("re-reads the files already up, not just the file list", async () => {
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [{ path: "src/a.ts", staged: false, status: "M" }],
    });
    vi.mocked(gitDiff).mockImplementation(async (_repo, staged) =>
      staged ? "" : diffFor("src/a.ts"),
    );
    vi.mocked(gitFileAtRev).mockResolvedValue("keep\ngone\n");
    vi.mocked(fsReadFile).mockResolvedValue("keep\none\n");

    const { container } = render(<AllChangesTabContent paneId={PANE} />);
    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());
    const readsBefore = vi.mocked(fsReadFile).mock.calls.length;

    // The working tree can move while this page is open. A rescan that only
    // refreshed the list would leave every mounted diff showing what it first
    // loaded.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() =>
      expect(vi.mocked(fsReadFile).mock.calls.length).toBeGreaterThan(readsBefore),
    );
    expect(gitStatus).toHaveBeenCalledTimes(2);
  });

  it("starts a new comparison at the top, and leaves a rescan where it was", async () => {
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [{ path: "src/a.ts", staged: false, status: "M" }],
    });
    vi.mocked(gitDiff).mockImplementation(async (_repo, staged) =>
      staged ? "" : diffFor("src/a.ts"),
    );
    vi.mocked(gitDiffFromBase).mockResolvedValue({
      rev: "1111111",
      diff: diffFor("src/z.ts"),
    });

    const { container } = render(<AllChangesTabContent paneId={PANE} />);
    await waitFor(() =>
      expect(container.querySelector('[data-diff-file="w:src/a.ts"]')).toBeTruthy(),
    );

    // The reader is a long way down the working tree's files. jsdom lays
    // nothing out, so the offset is stubbed; all that matters is that it is
    // not already zero. Every write is kept as well as the value: the landing
    // that opens a fresh page on its first change would, with no layout to
    // read, scroll to zero as well, so the value alone cannot say whether it
    // ran -- and it must not, or the heading naming the new comparison is the
    // one thing scrolled off.
    const root = container.querySelector<HTMLElement>(".overflow-auto")!;
    let scrollTop = 3000;
    const writes: number[] = [];
    Object.defineProperty(root, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        writes.push(v);
        scrollTop = v;
      },
    });

    act(() => {
      useComparisonBaseStore.getState().setBase("/repo", { kind: "ref", name: "origin/main" });
    });

    await waitFor(() =>
      expect(container.querySelector('[data-diff-file="w:src/z.ts"]')).toBeTruthy(),
    );
    // Left where it was, the reader is dropped part way into a stack of files
    // they have not read a line of, at a depth that measured the comparison
    // that is gone.
    expect(scrollTop).toBe(0);
    expect(writes).toEqual([0]);

    // A rescan of the same comparison is the page they are already reading.
    writes.length = 0;
    root.scrollTop = 1500;
    writes.length = 0;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(gitDiffFromBase).toHaveBeenCalledTimes(2));
    expect(writes).toEqual([]);
    expect(scrollTop).toBe(1500);
  });

  it("shows a file that was never added, while it says it includes them", async () => {
    useComparisonBaseStore.setState({
      byRepo: { "/repo": { kind: "ref", name: "origin/main" } },
      includeUncommitted: true,
    });
    vi.mocked(gitDiffFromBase).mockResolvedValue({
      rev: "1111111",
      diff: diffFor("tracked.ts"),
    });
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [
        { path: "tracked.ts", staged: false, status: "M" },
        { path: "brand-new.ts", staged: false, status: "?" },
      ],
    });

    const { container } = render(<AllChangesTabContent paneId={PANE} />);

    // `git diff <rev>` cannot see a file that was never added, so the page
    // was leaving one out while the checkbox beside it promised uncommitted
    // work was in. Both are here, sorted together rather than tacked on.
    await waitFor(() =>
      expect(container.querySelectorAll("[data-diff-file]").length).toBe(2),
    );
    expect(container.querySelector('[data-diff-file="w:brand-new.ts"]')).toBeTruthy();
    expect(useAllChangesLinkStore.getState().listing[PANE]?.files).toEqual([
      { rel: "brand-new.ts", status: "?" },
      { rel: "tracked.ts", status: "M" },
    ]);
  });

  it("leaves the working tree alone when the comparison does not reach it", async () => {
    useComparisonBaseStore.setState({
      byRepo: { "/repo": { kind: "range", from: "aaa", to: "bbb" } },
      includeUncommitted: true,
    });
    vi.mocked(gitDiffFromBase).mockResolvedValue({
      rev: "aaa",
      diff: diffFor("tracked.ts"),
    });

    const { container } = render(<AllChangesTabContent paneId={PANE} />);
    await waitFor(() =>
      expect(container.querySelectorAll("[data-diff-file]").length).toBe(1),
    );

    // Neither end of a range is on disk, so there is nothing on disk to ask
    // about -- and asking anyway would put a file in the list that belongs to
    // neither of the two points being compared.
    expect(gitStatus).not.toHaveBeenCalled();
  });

  it("names the ref that went away, and offers the way back", async () => {
    useComparisonBaseStore.setState({
      byRepo: { "/repo": { kind: "ref", name: "origin/merged-and-deleted" } },
    });
    vi.mocked(gitDiffFromBase).mockRejectedValue(new Error("unknown rev"));
    vi.mocked(gitResolveRev).mockResolvedValue(null);

    render(<AllChangesTabContent paneId={PANE} />);

    // A base picked at the start of a session can be gone by the middle of
    // it. "Something went wrong" about a name still shown in the header is
    // no help; this says which name and why.
    await waitFor(() =>
      expect(
        screen.getByText("baseGone:origin/merged-and-deleted"),
      ).toBeInTheDocument(),
    );
    expect(gitResolveRev).toHaveBeenCalledWith("/repo", "origin/merged-and-deleted");
    expect(screen.queryByText("diffLoadError")).not.toBeInTheDocument();

    // And the way out drops the base rather than leaving the reader to work
    // out that the selector in the header is now the only door.
    fireEvent.click(screen.getByRole("button", { name: "baseBackToWorktree" }));

    await waitFor(() => expect(gitStatus).toHaveBeenCalled());
    expect(useComparisonBaseStore.getState().byRepo["/repo"]).toBeUndefined();
  });

  it("still says only that it failed when the base is fine", async () => {
    useComparisonBaseStore.setState({
      byRepo: { "/repo": { kind: "ref", name: "origin/main" } },
    });
    vi.mocked(gitDiffFromBase).mockRejectedValue(new Error("no common history"));
    vi.mocked(gitResolveRev).mockResolvedValue("1111111");

    render(<AllChangesTabContent paneId={PANE} />);

    // The ref resolves, so whatever went wrong was not that -- and blaming
    // the base would send the reader after the wrong thing.
    await waitFor(() => expect(screen.getByText("diffLoadError")).toBeInTheDocument());
    expect(screen.queryByText(/^baseGone/)).not.toBeInTheDocument();
  });

  it("reads a file that moved at the name it moved from", async () => {
    useComparisonBaseStore.setState({
      byRepo: { "/repo": { kind: "ref", name: "origin/main" } },
    });
    vi.mocked(gitDiffFromBase).mockResolvedValue({
      rev: "1111111",
      diff: [
        "diff --git a/old/name.ts b/new/name.ts",
        "similarity index 90%",
        "rename from old/name.ts",
        "rename to new/name.ts",
        "--- a/old/name.ts",
        "+++ b/new/name.ts",
        "@@ -1 +1 @@",
        "-a",
        "+b",
        "",
      ].join("\n"),
    });
    vi.mocked(gitFileAtRev).mockResolvedValue("a\n");

    const { container } = render(<AllChangesTabContent paneId={PANE} />);
    await waitFor(() =>
      expect(container.querySelector('[data-diff-file="w:new/name.ts"]')).toBeTruthy(),
    );

    // git reports a rename as one entry under the new name, and the new name
    // does not exist at the base -- so reading the old side there gave an
    // empty document and the file read as a whole new one.
    await waitFor(() =>
      expect(gitFileAtRev).toHaveBeenCalledWith("/repo", "1111111", "old/name.ts"),
    );
    expect(gitFileAtRev).not.toHaveBeenCalledWith("/repo", "1111111", "new/name.ts");
    // And the row says where it came from, or a file that merely moved shows
    // an empty diff with nothing to explain it.
    expect(screen.getByText("← old/name.ts")).toBeInTheDocument();
  });

  it("labels a file by what happened to it, not by whether it lost lines", async () => {
    useComparisonBaseStore.setState({
      byRepo: { "/repo": { kind: "ref", name: "origin/main" } },
    });
    vi.mocked(gitDiffFromBase).mockResolvedValue({
      rev: "1111111",
      diff: [
        "diff --git a/grew.ts b/grew.ts",
        "--- a/grew.ts",
        "+++ b/grew.ts",
        "@@ -1 +1,2 @@",
        " keep",
        "+added",
        "diff --git a/fresh.ts b/fresh.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/fresh.ts",
        "@@ -0,0 +1 @@",
        "+hello",
        "",
      ].join("\n"),
    });

    const { container } = render(<AllChangesTabContent paneId={PANE} />);
    await waitFor(() =>
      expect(container.querySelectorAll("[data-diff-file]").length).toBe(2),
    );

    // A comparison of two points in history has no `git status` to ask, and
    // the counts it does have cannot tell an edit that only added lines from
    // a file that is genuinely new. The diff says which is which.
    const grew = container.querySelector<HTMLElement>('[data-diff-file="w:grew.ts"]')!;
    const fresh = container.querySelector<HTMLElement>('[data-diff-file="w:fresh.ts"]')!;
    expect(within(grew).getByText("M")).toBeInTheDocument();
    expect(within(fresh).getByText("A")).toBeInTheDocument();
    // And the panel is handed the same letters, being the same list.
    expect(useAllChangesLinkStore.getState().listing[PANE]?.files).toEqual([
      { rel: "fresh.ts", status: "A" },
      { rel: "grew.ts", status: "M" },
    ]);
  });

  it("names a binary file instead of trying to show it", async () => {
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [{ path: "logo.png", staged: false, status: "M" }],
    });
    vi.mocked(gitDiff).mockImplementation(async (_repo, staged) =>
      staged
        ? ""
        : [
            "diff --git a/logo.png b/logo.png",
            "Binary files a/logo.png and b/logo.png differ",
            "",
          ].join("\n"),
    );

    const { container } = render(<AllChangesTabContent paneId={PANE} />);

    await waitFor(() => expect(screen.getByText("allChangesBinary")).toBeInTheDocument());
    expect(container.querySelector(".cm-mergeView")).toBeNull();
    expect(gitFileAtRev).not.toHaveBeenCalled();
  });

  it("counts changes across every file, not just the one on screen", async () => {
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [
        { path: "a.ts", staged: false, status: "M" },
        { path: "b.ts", staged: false, status: "M" },
      ],
    });
    vi.mocked(gitDiff).mockImplementation(async (_repo, staged) =>
      staged
        ? ""
        : [
            "diff --git a/a.ts b/a.ts",
            "--- a/a.ts",
            "+++ b/a.ts",
            "@@ -1 +1 @@",
            "-x",
            "+y",
            "@@ -10 +10 @@",
            "-x",
            "+y",
            "diff --git a/b.ts b/b.ts",
            "--- a/b.ts",
            "+++ b/b.ts",
            "@@ -5 +5 @@",
            "-x",
            "+y",
            "",
          ].join("\n"),
    );

    render(<AllChangesTabContent paneId={PANE} />);

    // Two hunks in the first file and one in the second: the navigation walks
    // the page, not a file.
    await waitFor(() => expect(counter(3)).toBeInTheDocument());
    // Next walks the page rather than the file: three changes across two of
    // them, stepped through one at a time and stopping at the end.
    const next = screen.getByRole("button", { name: "diffNextChange" });
    expect(counter(3).textContent).toBe("1/3");
    fireEvent.click(next);
    expect(counter(3).textContent).toBe("2/3");
    fireEvent.click(next);
    expect(counter(3).textContent).toBe("3/3");
    fireEvent.click(next);
    expect(counter(3).textContent).toBe("3/3");
  });

  it("says so when the workspace is not a repository", async () => {
    vi.mocked(gitResolveRepo).mockResolvedValue(null);

    render(<AllChangesTabContent paneId={PANE} />);

    await waitFor(() => expect(screen.getByText("noRepo")).toBeInTheDocument());
    expect(gitStatus).not.toHaveBeenCalled();
  });

  it("says so when nothing has changed", async () => {
    render(<AllChangesTabContent paneId={PANE} />);

    await waitFor(() => expect(screen.getByText("noChanges")).toBeInTheDocument());
  });

  it("opens a file the panel asks for, and clears the request", async () => {
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [{ path: "src/a.ts", staged: false, status: "M" }],
    });
    vi.mocked(gitDiff).mockImplementation(async (_repo, staged) =>
      staged ? "" : diffFor("src/a.ts"),
    );

    const { container } = render(<AllChangesTabContent paneId={PANE} />);
    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: new RegExp("^allChangesCollapseFile") }));
    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeNull());

    // Clicking that row in the panel means "show me this file", so a file the
    // reader had shut comes back rather than landing them on a bare header.
    act(() => {
      useAllChangesLinkStore.getState().request(PANE, { rel: "src/a.ts", staged: false });
    });

    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());
    expect(useAllChangesLinkStore.getState().file[PANE]).toBeUndefined();
  });

  it("drops a request for a file it does not carry", async () => {
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [{ path: "src/a.ts", staged: false, status: "M" }],
    });
    vi.mocked(gitDiff).mockImplementation(async (_repo, staged) =>
      staged ? "" : diffFor("src/a.ts"),
    );

    const { container } = render(<AllChangesTabContent paneId={PANE} />);
    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());

    act(() => {
      useAllChangesLinkStore.getState().request(PANE, { rel: "src/gone.ts", staged: false });
    });

    // Dropped rather than left pending, or it would fire at some unrelated
    // moment after the next rescan.
    await waitFor(() => expect(useAllChangesLinkStore.getState().file[PANE]).toBeUndefined());
  });
});
