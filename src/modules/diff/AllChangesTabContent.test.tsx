import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AllChangesTabContent } from "./AllChangesTabContent";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && "count" in vars ? `${key}:${String(vars.count)}` : key,
  }),
  // tabsStore transitively pulls in the real i18n init, which registers this
  // plugin object during module load.
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/modules/source-control/lib/gitBridge", () => ({
  gitResolveRepo: vi.fn(),
  gitStatus: vi.fn(),
  gitDiff: vi.fn(),
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
  gitFileAtRev,
  gitResolveRepo,
  gitStatus,
} from "@/modules/source-control/lib/gitBridge";
import { fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDiffCommentStore } from "./lib/diffCommentStore";

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

describe("AllChangesTabContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ rootPath: "/repo" });
    useDiffCommentStore.setState({ comments: [] });
    useSettingsStore.setState({ diffUnified: false });
    vi.mocked(gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitDiff).mockResolvedValue("");
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

    const { container } = render(<AllChangesTabContent />);

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

  it("reads each file the way the single-file tab does", async () => {
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [{ path: "a.ts", staged: true, status: "M" }],
      unstaged: [{ path: "b.ts", staged: false, status: "M" }],
    });

    render(<AllChangesTabContent />);

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

    const { container } = render(<AllChangesTabContent />);

    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());
    // Counted off the documents, since the scan had nothing to say about it —
    // and reported up, so the page total covers it too.
    const section = container.querySelector<HTMLElement>('[data-diff-file="w:new.ts"]');
    expect(within(section!).getByText("+2")).toBeInTheDocument();
    expect(within(section!).getByText("−0")).toBeInTheDocument();
    expect(screen.getAllByText("+2").length).toBe(2);
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

    const { container } = render(<AllChangesTabContent />);

    await waitFor(() => expect(screen.getByText("allChangesFolded:500")).toBeInTheDocument());
    // Folded means not read at all: no documents fetched, no editors built.
    expect(container.querySelector(".cm-mergeView")).toBeNull();
    expect(gitFileAtRev).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "allChangesShowFull" }));

    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());
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

    const { container } = render(<AllChangesTabContent />);

    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());
    expect(screen.getByText("0/1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "allChangesCollapseFile" }));

    // The editors go, and so does the file's hunk in the page's navigation —
    // there is nothing on screen left to land on.
    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeNull());
    expect(screen.queryByText("0/1")).toBeNull();
    // The header still reads, counts and all.
    expect(screen.getByText("a.ts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "allChangesExpandFile" }));
    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());
  });

  it("opens an oversized file from its own header, not just the button", async () => {
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

    const { container } = render(<AllChangesTabContent />);

    // A folded file reads as shut, so its header opens it the same way the
    // explicit button does.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "allChangesExpandFile" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "allChangesExpandFile" }));

    await waitFor(() => expect(container.querySelector(".cm-mergeView")).toBeTruthy());
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

    const { container } = render(<AllChangesTabContent />);

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

    render(<AllChangesTabContent />);

    // Two hunks in the first file and one in the second: the navigation walks
    // the page, not a file.
    await waitFor(() => expect(screen.getByText("0/3")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "diffNextChange" }));
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("says so when the workspace is not a repository", async () => {
    vi.mocked(gitResolveRepo).mockResolvedValue(null);

    render(<AllChangesTabContent />);

    await waitFor(() => expect(screen.getByText("noRepo")).toBeInTheDocument());
    expect(gitStatus).not.toHaveBeenCalled();
  });

  it("says so when nothing has changed", async () => {
    render(<AllChangesTabContent />);

    await waitFor(() => expect(screen.getByText("noChanges")).toBeInTheDocument());
  });
});
