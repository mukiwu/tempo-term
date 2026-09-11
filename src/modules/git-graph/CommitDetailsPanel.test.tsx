import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { CommitDetailsPanel } from "./CommitDetailsPanel";
import {
  gitCommitDetails,
  gitCommitFileDiff,
  gitCommitRangeFiles,
  gitCommitRangeFileDiff,
} from "./lib/gitGraphBridge";
import { gitDiff } from "@/modules/source-control/lib/gitBridge";
import { fsReadFile } from "@/modules/explorer/lib/fsBridge";
import type { CommitNode } from "./types";

vi.mock("./lib/gitGraphBridge", () => ({
  gitCommitDetails: vi.fn(),
  gitCommitFileDiff: vi.fn().mockResolvedValue(""),
  gitCommitRangeFiles: vi.fn(),
  gitCommitRangeFileDiff: vi.fn().mockResolvedValue(""),
}));

// Only the two calls the working-tree mode makes; the panel takes nothing else
// from either module at runtime (the rest are types).
vi.mock("@/modules/source-control/lib/gitBridge", () => ({
  gitDiff: vi.fn().mockResolvedValue(""),
}));
vi.mock("@/modules/explorer/lib/fsBridge", () => ({
  fsReadFile: vi.fn().mockResolvedValue(""),
}));

const LABELS = {
  author: "Author",
  date: "Date",
  changedFiles: "Changed Files",
  noChanges: "No changes",
  noDiff: "No diff",
  noFileSelected: "Select a file",
  close: "Close",
  compareBadge: "Comparing",
  diffTab: "Diff",
  aiTab: "AI Explain",
  aiGenerate: "Explain",
  aiExplaining: "...",
  aiRegenerate: "Regen",
  aiNeedKey: "No key",
  aiEmpty: "Empty",
  viewFolder: "Group by folder",
  viewFlat: "Flat view",
  expandFolder: (name: string) => `Expand ${name}`,
  collapseFolder: (name: string) => `Collapse ${name}`,
  uncommittedTitle: "Uncommitted changes",
  uncommittedClean: "No uncommitted changes",
  relativeTo: (hash: string) => `against ${hash}`,
  stagedTitle: "Staged",
  unstagedTitle: "Unstaged",
};

const COMMIT: CommitNode = {
  hash: "abc1234",
  parents: [],
  author: "a",
  date: "today",
  message: "feat: x",
  refs: [],
};

describe("CommitDetailsPanel changed-files tree", () => {
  // The flat/folder toggle is remembered, so one test's choice must not
  // leak into the next.
  beforeEach(() => localStorage.clear());

  it("nests dist/aaa and dist/bbb under one dist folder in tree mode", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [
        { status: "M", path: "dist/aaa/x.ts" },
        { status: "M", path: "dist/bbb/y.ts" },
      ],
    });
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("dist/aaa/x.ts");

    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    await waitFor(() => expect(screen.getAllByText("dist")).toHaveLength(1));
    expect(screen.getByText("aaa")).toBeInTheDocument();
    expect(screen.getByText("x.ts")).toBeInTheDocument();
  });

  it("remembers the flat/folder view mode across remounts", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [{ status: "M", path: "dist/aaa/x.ts" }],
    });
    const panel = () => (
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />
    );
    const first = render(panel());
    await screen.findByText("dist/aaa/x.ts");
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findByText("x.ts");
    first.unmount();

    render(panel());

    expect(await screen.findByText("x.ts")).toBeInTheDocument();
    expect(screen.queryByText("dist/aaa/x.ts")).not.toBeInTheDocument();
  });

  it("collapsing a folder in tree mode hides its files", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [{ status: "M", path: "dist/aaa/x.ts" }],
    });
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("dist/aaa/x.ts");
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findByText("dist");

    fireEvent.click(screen.getByRole("button", { name: "Collapse dist" }));

    expect(screen.queryByText("x.ts")).not.toBeInTheDocument();
  });

  it("clicking a nested file in tree mode loads its diff", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [{ status: "M", path: "dist/aaa/x.ts" }],
    });
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("dist/aaa/x.ts");
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findByText("x.ts");

    fireEvent.click(screen.getByText("x.ts"));

    await waitFor(() =>
      expect(gitCommitFileDiff).toHaveBeenCalledWith("/repo", "abc1234", "dist/aaa/x.ts"),
    );
  });
});

describe("CommitDetailsPanel compare mode", () => {
  // The flat/folder toggle is remembered, so one test's choice must not
  // leak into the next.
  beforeEach(() => localStorage.clear());

  const OTHER: CommitNode = {
    hash: "def5678",
    parents: [],
    author: "b",
    date: "yesterday",
    message: "fix: y",
    refs: [],
  };

  it("shows both hashes in the header and fetches the range diff", async () => {
    vi.mocked(gitCommitRangeFiles).mockResolvedValue([{ status: "M", path: "a.ts" }]);
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "compare", from: OTHER, to: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );

    expect(await screen.findByText("def5678 .. abc1234")).toBeInTheDocument();
    expect(screen.getByText("Comparing")).toBeInTheDocument();
    await waitFor(() =>
      expect(gitCommitRangeFileDiff).toHaveBeenCalledWith("/repo", "def5678", "abc1234", "a.ts"),
    );
  });

  it("does not show the compare badge in single-commit mode", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({ message: "feat: x", files: [] });
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("abc1234");
    expect(screen.queryByText("Comparing")).not.toBeInTheDocument();
  });

  it("hides the AI tab in compare mode", async () => {
    vi.mocked(gitCommitRangeFiles).mockResolvedValue([{ status: "M", path: "a.ts" }]);
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "compare", from: OTHER, to: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("a.ts");
    expect(screen.queryByRole("button", { name: "AI Explain" })).not.toBeInTheDocument();
  });

  it("does not crash when the selection flips to compare mode while the AI tab is active", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [{ status: "M", path: "a.ts" }],
    });
    vi.mocked(gitCommitRangeFiles).mockResolvedValue([{ status: "M", path: "a.ts" }]);

    const { rerender } = render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("a.ts");
    fireEvent.click(screen.getByRole("button", { name: "AI Explain" }));
    await screen.findByText("Empty");

    rerender(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "compare", from: OTHER, to: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );

    expect(await screen.findByText("No diff")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI Explain" })).not.toBeInTheDocument();
  });
});

describe("CommitDetailsPanel working-tree mode", () => {
  beforeEach(() => {
    localStorage.clear();
    // Call history matters here — one test counts how often a side is read —
    // and this file's mocks are module-level, so they carry over otherwise.
    vi.mocked(gitDiff).mockClear();
    vi.mocked(gitDiff).mockResolvedValue("");
    vi.mocked(fsReadFile).mockClear();
    vi.mocked(fsReadFile).mockResolvedValue("");
  });

  const STATUS = {
    branch: "main",
    staged: [{ path: "src/a.ts", staged: true, status: "M" }],
    unstaged: [
      { path: "src/b.ts", staged: false, status: "M" },
      { path: "src/new.ts", staged: false, status: "?" },
    ],
  };

  function renderWorkspace(uncommitted: typeof STATUS | null = STATUS) {
    const ui = (status: typeof STATUS | null) => (
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "workspace" }}
        onClose={() => {}}
        uncommitted={status}
        headHash="abc1234"
        labels={LABELS}
      />
    );
    const view = render(ui(uncommitted));
    return {
      rerender: (status: typeof STATUS | null) => view.rerender(ui(status)),
    };
  }

  it("splits the files into staged and unstaged groups", async () => {
    renderWorkspace();
    expect(await screen.findByText("Staged (1)")).toBeInTheDocument();
    expect(screen.getByText("Unstaged (2)")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
  });

  it("titles the header and says which commit the changes sit on", async () => {
    renderWorkspace();
    // Awaited so the first file's diff load settles inside act(); the header is
    // already on screen before it.
    await screen.findByText("Staged (1)");
    expect(screen.getByText("Uncommitted changes")).toBeInTheDocument();
    expect(screen.getByText("against abc1234")).toBeInTheDocument();
  });

  it("has no AI tab — there is no commit to explain", async () => {
    renderWorkspace();
    await screen.findByText("Staged (1)");
    expect(screen.queryByRole("button", { name: "AI Explain" })).not.toBeInTheDocument();
  });

  it("says the tree is clean rather than showing an empty list", () => {
    renderWorkspace({ branch: "main", staged: [], unstaged: [] });
    expect(screen.getByText("No uncommitted changes")).toBeInTheDocument();
  });

  it("reads an untracked file off disk instead of asking git to diff it", async () => {
    // `git diff` never mentions an untracked file, so slicing its section would
    // give nothing and the panel would claim there is no difference.
    vi.mocked(fsReadFile).mockResolvedValue("fresh\n");
    renderWorkspace();
    fireEvent.click(await screen.findByText("src/new.ts"));
    await waitFor(() => expect(fsReadFile).toHaveBeenCalledWith("/repo/src/new.ts"));
    expect(await screen.findByText("+fresh")).toBeInTheDocument();
  });

  it("asks for the staged side when a staged file is picked", async () => {
    renderWorkspace();
    await screen.findByText("src/a.ts");
    await waitFor(() => expect(gitDiff).toHaveBeenCalledWith("/repo", true));
  });

  it("asks for the unstaged side when an unstaged tracked file is picked", async () => {
    renderWorkspace();
    fireEvent.click(await screen.findByText("src/b.ts"));
    await waitFor(() => expect(gitDiff).toHaveBeenCalledWith("/repo", false));
  });

  const THREE_UNSTAGED = {
    branch: "main",
    staged: [] as typeof STATUS.staged,
    unstaged: [
      { path: "src/b.ts", staged: false, status: "M" },
      { path: "src/c.ts", staged: false, status: "M" },
      { path: "src/d.ts", staged: false, status: "M" },
    ],
  };

  it("reads a side once however many of its files are opened", async () => {
    // `git_diff` answers for a whole side at a time, so asking again per row
    // re-runs the subprocess and re-scans the entire diff — a cost that grows
    // with the repository rather than with the file being read.
    renderWorkspace(THREE_UNSTAGED);
    await screen.findByText("src/b.ts");
    await waitFor(() => expect(gitDiff).toHaveBeenCalledWith("/repo", false));
    fireEvent.click(screen.getByText("src/c.ts"));
    fireEvent.click(screen.getByText("src/d.ts"));
    fireEvent.click(screen.getByText("src/b.ts"));
    await waitFor(() => expect(screen.getByText("src/b.ts")).toBeInTheDocument());
    expect(vi.mocked(gitDiff).mock.calls).toHaveLength(1);
  });

  it("reads each side once, not one read shared between them", async () => {
    renderWorkspace();
    await screen.findByText("src/a.ts");
    await waitFor(() => expect(gitDiff).toHaveBeenCalledWith("/repo", true));
    fireEvent.click(screen.getByText("src/b.ts"));
    await waitFor(() => expect(gitDiff).toHaveBeenCalledWith("/repo", false));
    fireEvent.click(screen.getByText("src/a.ts"));
    await waitFor(() => expect(screen.getByText("src/a.ts")).toBeInTheDocument());
    expect(vi.mocked(gitDiff).mock.calls).toHaveLength(2);
  });

  it("re-reads the diff once the status has been refreshed", async () => {
    // Held for the life of one status, not for the life of the panel: a commit
    // or an edit elsewhere has to reach the file the reader is looking at.
    const { rerender } = renderWorkspace(THREE_UNSTAGED);
    await screen.findByText("src/b.ts");
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(1));
    rerender({ ...THREE_UNSTAGED });
    fireEvent.click(screen.getByText("src/c.ts"));
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(2));
  });

  it("renders the section of a file whose name git had to escape", async () => {
    // `git diff` escapes a non-ASCII path under `core.quotePath`, while the
    // path here came from `git_status` via libgit2 and is raw UTF-8.
    vi.mocked(gitDiff).mockResolvedValue(
      [
        'diff --git "a/src/\\344\\270\\255\\346\\226\\207.ts" "b/src/\\344\\270\\255\\346\\226\\207.ts"',
        "@@ -1 +1 @@",
        "+新的一行",
        "",
      ].join("\n"),
    );
    renderWorkspace({
      branch: "main",
      staged: [] as typeof STATUS.staged,
      unstaged: [{ path: "src/中文.ts", staged: false, status: "M" }],
    });
    expect(await screen.findByText("+新的一行")).toBeInTheDocument();
  });
});
