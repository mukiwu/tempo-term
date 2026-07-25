import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { useWorkspaceStore } from "@/stores/workspaceStore";

vi.mock("./lib/gitBridge", () => ({
  gitResolveRepo: vi.fn().mockResolvedValue("/repo"),
  gitStatus: vi.fn(),
  gitLog: vi.fn().mockResolvedValue([]),
  gitDiff: vi.fn().mockResolvedValue(""),
  gitStage: vi.fn().mockResolvedValue(undefined),
  gitUnstage: vi.fn().mockResolvedValue(undefined),
  gitCommit: vi.fn().mockResolvedValue(undefined),
  gitPush: vi.fn().mockResolvedValue(undefined),
  gitFileAtRev: vi.fn().mockResolvedValue(""),
  gitRestoreFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./lib/aiCommit", () => ({
  generateCommitMessage: vi.fn().mockResolvedValue(""),
}));

import { SourceControlView } from "./SourceControlView";
import * as gitBridge from "./lib/gitBridge";
import type { GitStatus } from "./lib/gitBridge";
import { useTabsStore } from "@/stores/tabsStore";
import { usePendingGraphSelectionStore } from "@/modules/git-graph/lib/pendingGraphSelectionStore";

const STATUS_ONE_MODIFIED: GitStatus = {
  branch: "main",
  staged: [],
  unstaged: [{ path: "src/a.ts", staged: false, status: "M" }],
};

describe("SourceControlView row interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitBridge.gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitBridge.gitLog).mockResolvedValue([]);
    vi.mocked(gitBridge.gitStatus).mockResolvedValue(STATUS_ONE_MODIFIED);
    useWorkspaceStore.getState().setRoot("/repo");
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("opens a diff tab when a changed file row is clicked", async () => {
    render(<SourceControlView />);
    fireEvent.click(await screen.findByText("src/a.ts"));

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].kind).toBe("diff");
    expect(tabs[0].title).toBe("a.ts");
  });

  it("confirms before discarding and calls gitRestoreFile", async () => {
    render(<SourceControlView />);
    await screen.findByText("src/a.ts");

    fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }));
    expect(gitBridge.gitRestoreFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(gitBridge.gitRestoreFile).toHaveBeenCalledWith("/repo", "src/a.ts"),
    );
  });

  it("right-click opens a custom menu with open, stage, copy and discard items", async () => {
    render(<SourceControlView />);
    fireEvent.contextMenu(await screen.findByText("src/a.ts"));

    expect(screen.getByRole("menuitem", { name: "Open File" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Show Diff" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Stage" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy Path" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Discard Changes" })).toBeInTheDocument();
  });

  it("does not open a diff tab when a context-menu item is clicked", async () => {
    // jsdom has no clipboard; the menu action calls writeText.
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<SourceControlView />);
    fireEvent.contextMenu(await screen.findByText("src/a.ts"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Path" }));

    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it("stages the file from the context menu", async () => {
    render(<SourceControlView />);
    fireEvent.contextMenu(await screen.findByText("src/a.ts"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Stage" }));

    await waitFor(() => expect(gitBridge.gitStage).toHaveBeenCalledWith("/repo", "src/a.ts"));
  });

  it("history row right-click offers copy hash", async () => {
    vi.mocked(gitBridge.gitLog).mockResolvedValue([
      { id: "abc1234", summary: "feat: x", author: "a", timestamp: 1, parents: [] },
    ]);
    render(<SourceControlView />);
    fireEvent.contextMenu(await screen.findByText("feat: x"));

    expect(screen.getByRole("menuitem", { name: "Copy Hash" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy Message" })).toBeInTheDocument();
  });

  it("offers no discard button for untracked or staged rows", async () => {
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({
      branch: "main",
      staged: [{ path: "staged.ts", staged: true, status: "M" }],
      unstaged: [{ path: "new.ts", staged: false, status: "?" }],
    });
    render(<SourceControlView />);
    await screen.findByText("new.ts");

    expect(screen.queryByRole("button", { name: "Discard Changes" })).not.toBeInTheDocument();
  });
});

describe("SourceControlView collapsible sections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitBridge.gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitBridge.gitLog).mockResolvedValue([]);
    vi.mocked(gitBridge.gitStatus).mockResolvedValue(STATUS_ONE_MODIFIED);
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("collapses and re-expands a section from its header button", async () => {
    render(<SourceControlView />);
    await screen.findByText("src/a.ts");

    const header = screen.getByRole("button", { name: "Changes" });
    expect(header).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(header);
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(header);
    expect(await screen.findByText("src/a.ts")).toBeInTheDocument();
  });

  it("keeps 'stage all' usable while collapsed without toggling the section", async () => {
    render(<SourceControlView />);
    await screen.findByText("src/a.ts");

    fireEvent.click(screen.getByRole("button", { name: "Changes" }));
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stage all" }));

    await waitFor(() => expect(gitBridge.gitStage).toHaveBeenCalledWith("/repo", "src/a.ts"));
    // Staging is not a toggle gesture — the section must stay collapsed.
    expect(screen.getByRole("button", { name: "Changes" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("SourceControlView folder view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitBridge.gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitBridge.gitLog).mockResolvedValue([]);
    vi.mocked(gitBridge.gitStage).mockResolvedValue(undefined);
    vi.mocked(gitBridge.gitUnstage).mockResolvedValue(undefined);
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [
        { path: "src/a.ts", staged: false, status: "M" },
        { path: "src/b.ts", staged: false, status: "M" },
        { path: "docs/c.md", staged: false, status: "M" },
      ],
    });
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("stages every file in a folder when the folder's stage button is clicked", async () => {
    render(<SourceControlView />);
    await screen.findByText("src/a.ts");

    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    const stageSrc = await screen.findByRole("button", {
      name: "Stage Folder (Including Subfolders): src",
    });
    fireEvent.click(stageSrc);

    await waitFor(() => {
      expect(gitBridge.gitStage).toHaveBeenCalledWith("/repo", "src/a.ts");
    });
    expect(gitBridge.gitStage).toHaveBeenCalledWith("/repo", "src/b.ts");
    expect(gitBridge.gitStage).not.toHaveBeenCalledWith("/repo", "docs/c.md");
  });

  it("unstages every file in a folder when the folder's unstage button is clicked", async () => {
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({
      branch: "main",
      staged: [
        { path: "src/a.ts", staged: true, status: "M" },
        { path: "src/b.ts", staged: true, status: "M" },
      ],
      unstaged: [],
    });

    render(<SourceControlView />);
    await screen.findByText("src/a.ts");

    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    const unstageSrc = await screen.findByRole("button", {
      name: "Unstage Folder (Including Subfolders): src",
    });
    fireEvent.click(unstageSrc);

    await waitFor(() => {
      expect(gitBridge.gitUnstage).toHaveBeenCalledWith("/repo", "src/a.ts");
    });
    expect(gitBridge.gitUnstage).toHaveBeenCalledWith("/repo", "src/b.ts");
  });

  it("labels an untracked directory entry by name in folder view, not a blank row", async () => {
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [{ path: "a/b/dir/", staged: false, status: "?" }],
    });

    render(<SourceControlView />);
    await screen.findByText("a/b/dir/"); // flat view shows the full path

    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    // Grouped under "a/b", the row keeps a readable "dir/" label.
    expect(await screen.findByText("dir/")).toBeInTheDocument();
  });
});

describe("SourceControlView nested folder tree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitBridge.gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitBridge.gitLog).mockResolvedValue([]);
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [
        { path: "dist/aaa/x.ts", staged: false, status: "M" },
        { path: "dist/bbb/y.ts", staged: false, status: "M" },
      ],
    });
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("nests dist/aaa and dist/bbb under a single dist folder instead of two top-level groups", async () => {
    render(<SourceControlView />);
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    await screen.findByText("x.ts");
    // Exactly one "dist" folder header exists — aaa/bbb are its children, not
    // separate top-level groups (the bug this batch fixes).
    expect(screen.getAllByText("dist")).toHaveLength(1);
    expect(screen.getByText("aaa")).toBeInTheDocument();
    expect(screen.getByText("bbb")).toBeInTheDocument();
  });

  it("staging the top folder stages every file in the whole subtree, not just direct children", async () => {
    render(<SourceControlView />);
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findByText("x.ts");

    // aria-label is `${folderActionLabel}: ${path}`, e.g. "Stage Folder
    // (Including Subfolders): dist" once the wording update lands.
    fireEvent.click(screen.getByRole("button", { name: /stage folder.*: dist$/i }));

    await waitFor(() => {
      expect(gitBridge.gitStage).toHaveBeenCalledWith("/repo", "dist/aaa/x.ts");
      expect(gitBridge.gitStage).toHaveBeenCalledWith("/repo", "dist/bbb/y.ts");
    });
  });

  it("collapsing a folder hides its nested subtree", async () => {
    render(<SourceControlView />);
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findByText("x.ts");

    fireEvent.click(screen.getByRole("button", { name: "Collapse dist" }));

    expect(screen.queryByText("x.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("aaa")).not.toBeInTheDocument();
  });

  it("gives same-named folders at different paths distinct collapse-button labels", async () => {
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [{ path: "frontend/src/a.ts", staged: false, status: "M" }, { path: "backend/src/b.ts", staged: false, status: "M" }],
    });
    render(<SourceControlView />);
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findAllByText("src");

    // Two folders share the leaf name "src" (frontend/src, backend/src) —
    // each collapse button must carry a distinct, path-qualified label.
    expect(screen.getByRole("button", { name: "Collapse frontend/src" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse backend/src" })).toBeInTheDocument();
  });
});

describe("SourceControlView refresh feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitBridge.gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitBridge.gitLog).mockResolvedValue([]);
    useWorkspaceStore.setState({ rootPath: "/root" });
  });

  it("spins and disables the refresh button while a reload is in flight", async () => {
    // Hold gitStatus pending so the refresh stays in flight while we assert.
    let resolveStatus!: (value: GitStatus) => void;
    vi.mocked(gitBridge.gitStatus).mockImplementation(
      () =>
        new Promise<GitStatus>((resolve) => {
          resolveStatus = resolve;
        }),
    );

    render(<SourceControlView />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /refresh/i })).toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: /refresh/i }).querySelector(".animate-spin"),
    ).not.toBeNull();

    resolveStatus({ branch: "main", staged: [], unstaged: [] });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /refresh/i })).not.toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: /refresh/i }).querySelector(".animate-spin"),
    ).toBeNull();
  });
});

describe("SourceControlView commit jump", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitBridge.gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({ branch: "main", staged: [], unstaged: [] });
    vi.mocked(gitBridge.gitLog).mockResolvedValue([
      { id: "abc1234", summary: "feat: x", author: "a", timestamp: 1, parents: [] },
    ]);
    useWorkspaceStore.getState().setRoot("/repo");
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    usePendingGraphSelectionStore.setState({ hash: null });
  });

  it("opens the Git Graph tab and requests selection of the clicked commit", async () => {
    render(<SourceControlView />);
    fireEvent.click(await screen.findByText("feat: x"));

    expect(usePendingGraphSelectionStore.getState().hash).toBe("abc1234");
    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].kind).toBe("git-graph");
  });

  it("offers the same jump from the context menu", async () => {
    render(<SourceControlView />);
    fireEvent.contextMenu(await screen.findByText("feat: x"));
    fireEvent.click(screen.getByRole("menuitem", { name: "View in Git Graph" }));

    expect(usePendingGraphSelectionStore.getState().hash).toBe("abc1234");
  });
});

describe("SourceControlView commit graph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitBridge.gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({ branch: "main", staged: [], unstaged: [] });
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("draws one graph dot per history commit, marking the newest as HEAD", async () => {
    vi.mocked(gitBridge.gitLog).mockResolvedValue([
      { id: "c3", summary: "third", author: "a", timestamp: 3, parents: ["c2"] },
      { id: "c2", summary: "second", author: "a", timestamp: 2, parents: ["c1"] },
      { id: "c1", summary: "first", author: "a", timestamp: 1, parents: [] },
    ]);

    const { container } = render(<SourceControlView />);
    await screen.findByText("third");

    const dots = container.querySelectorAll("svg.history-graph circle");
    expect(dots).toHaveLength(3);
    // The first commit returned by git log is always HEAD; it gets a larger
    // dot filled with the accent colour instead of a branch-lane colour.
    expect(dots[0].getAttribute("fill")).toBe("var(--color-accent)");
    expect(Number(dots[0].getAttribute("r"))).toBeGreaterThan(
      Number(dots[1].getAttribute("r")),
    );
  });

  it("draws a connector for each parent link in a linear history", async () => {
    vi.mocked(gitBridge.gitLog).mockResolvedValue([
      { id: "c2", summary: "second", author: "a", timestamp: 2, parents: ["c1"] },
      { id: "c1", summary: "first", author: "a", timestamp: 1, parents: [] },
    ]);

    const { container } = render(<SourceControlView />);
    await screen.findByText("second");

    expect(container.querySelectorAll("svg.history-graph path")).toHaveLength(1);
  });

  it("opens a second lane for a merge commit", async () => {
    vi.mocked(gitBridge.gitLog).mockResolvedValue([
      { id: "m", summary: "merge", author: "a", timestamp: 3, parents: ["c1", "c2"] },
      { id: "c2", summary: "side", author: "a", timestamp: 2, parents: ["c1"] },
      { id: "c1", summary: "first", author: "a", timestamp: 1, parents: [] },
    ]);

    const { container } = render(<SourceControlView />);
    await screen.findByText("merge");

    // Three parent links total: m→c1, m→c2 (the merge's two parents), c2→c1.
    expect(container.querySelectorAll("svg.history-graph path")).toHaveLength(3);
  });
});
