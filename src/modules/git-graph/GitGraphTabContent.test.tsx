import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { GitGraphTabContent } from "./GitGraphTabContent";
import { usePendingGraphSelectionStore } from "./lib/pendingGraphSelectionStore";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";
import { useWorkspaceStore } from "@/stores/workspaceStore";

vi.mock("@/modules/source-control/lib/gitBridge", () => ({
  gitResolveRepo: vi.fn().mockResolvedValue("/repo"),
}));

vi.mock("./lib/gitGraphBridge", () => ({
  gitGraphLog: vi.fn(),
  gitBranches: vi.fn().mockResolvedValue([]),
  gitFetch: vi.fn(),
  gitCommitDetails: vi.fn().mockResolvedValue({ message: "", files: [] }),
  gitCommitFileDiff: vi.fn().mockResolvedValue(""),
  gitCommitRangeFiles: vi.fn().mockResolvedValue([]),
  gitCommitRangeFileDiff: vi.fn().mockResolvedValue(""),
  gitWorktreeList: vi.fn().mockResolvedValue([]),
}));

import { gitCommitDetails, gitGraphLog, gitWorktreeList } from "./lib/gitGraphBridge";

function commitList(hashes: string[], hasMore: boolean) {
  return {
    commits: hashes.map((hash) => ({
      hash,
      parents: [],
      author: "a",
      date: "d",
      message: `msg ${hash}`,
      refs: [],
    })),
    hasMore,
  };
}

describe("GitGraphTabContent pending commit selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitWorktreeList).mockResolvedValue([]);
    usePendingGraphSelectionStore.setState({ hash: null });
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("selects the pending commit once it is loaded", async () => {
    vi.mocked(gitGraphLog).mockImplementation(async () => commitList(["aaa1111", "bbb2222"], false));
    usePendingGraphSelectionStore.getState().request("bbb2222");

    render(<GitGraphTabContent />);

    await waitFor(() => expect(screen.getByText("msg bbb2222")).toBeInTheDocument());
    // Selecting opens the details panel, which fetches this commit's details.
    await waitFor(() => expect(screen.getAllByText("bbb2222").length).toBeGreaterThan(0));
    expect(usePendingGraphSelectionStore.getState().hash).toBeNull();
  });

  it("loads more pages to find a pending commit not on the first page, up to a cap", async () => {
    vi.mocked(gitGraphLog)
      .mockResolvedValueOnce(commitList(["aaa1111"], true))
      .mockResolvedValueOnce(commitList(["aaa1111", "ccc3333"], false));
    usePendingGraphSelectionStore.getState().request("ccc3333");

    render(<GitGraphTabContent />);

    await waitFor(() => expect(screen.getByText("msg ccc3333")).toBeInTheDocument());
    expect(usePendingGraphSelectionStore.getState().hash).toBeNull();
  });

  it("gives up silently once retries are exhausted and the hash is never found", async () => {
    vi.mocked(gitGraphLog).mockImplementation(async () => commitList(["aaa1111"], false));
    usePendingGraphSelectionStore.getState().request("zzz9999");

    render(<GitGraphTabContent />);

    await waitFor(() => expect(screen.getByText("msg aaa1111")).toBeInTheDocument());
    await waitFor(() => expect(usePendingGraphSelectionStore.getState().hash).toBeNull());
  });

  it("retries even when hasMore is already false, since a new commit can land after the tab's last load", async () => {
    // The tab already loaded and saw no more history (hasMore: false) before
    // the sidebar's commit form created a brand new commit — reload() must
    // still be retried so it re-queries git log and picks the new commit up.
    vi.mocked(gitGraphLog)
      .mockResolvedValueOnce(commitList(["aaa1111"], false))
      .mockResolvedValueOnce(commitList(["aaa1111", "ddd4444"], false));
    usePendingGraphSelectionStore.getState().request("ddd4444");

    render(<GitGraphTabContent />);

    await waitFor(() => expect(screen.getByText("msg ddd4444")).toBeInTheDocument());
    expect(usePendingGraphSelectionStore.getState().hash).toBeNull();
  });

  it("selects a second commit requested after the tab is already mounted with an unchanged commit list", async () => {
    // The Git Graph tab stays mounted for the whole session once opened, so
    // a jump request that arrives while `commits` never changes again must
    // still be picked up — not silently dropped because the effect only
    // reran on [commits, hasMore, loadMore] the first time.
    vi.mocked(gitGraphLog).mockImplementation(async () => commitList(["aaa1111", "bbb2222"], false));
    usePendingGraphSelectionStore.getState().request("aaa1111");

    render(<GitGraphTabContent />);

    await waitFor(() => expect(usePendingGraphSelectionStore.getState().hash).toBeNull());

    usePendingGraphSelectionStore.getState().request("bbb2222");

    await waitFor(() => expect(usePendingGraphSelectionStore.getState().hash).toBeNull());
    await waitFor(() => expect(screen.getAllByText("bbb2222").length).toBeGreaterThan(0));
  });

  it("does not select a commit that a search filter is currently hiding, and gives up without retrying", async () => {
    vi.mocked(gitGraphLog).mockImplementation(async () => commitList(["aaa1111", "bbb2222"], false));
    render(<GitGraphTabContent />);
    await screen.findByText("msg aaa1111");

    fireEvent.click(screen.getByRole("button", { name: "Search commits" }));
    fireEvent.change(screen.getByPlaceholderText("Search message, author, hash…"), {
      target: { value: "aaa1111" },
    });
    await waitFor(() => expect(screen.queryByText("msg bbb2222")).not.toBeInTheDocument());

    usePendingGraphSelectionStore.getState().request("bbb2222");

    await waitFor(() => expect(usePendingGraphSelectionStore.getState().hash).toBeNull());
    // loadMore would have paged in nothing new (there's nothing more to load
    // here), so this also confirms no extra gitGraphLog calls were wasted
    // retrying a commit the search filter — not pagination — was hiding.
    expect(vi.mocked(gitGraphLog)).toHaveBeenCalledTimes(1);
  });

  it("gives a fresh retry budget to a new request instead of inheriting a previous request's leftover attempts", async () => {
    // First request ("missing") burns through some retries against a repo
    // that never grows past one page, so it gives up after 5 attempts. A
    // later request for a real commit must not inherit that spent budget.
    vi.mocked(gitGraphLog).mockImplementation(async () => commitList(["aaa1111"], false));
    usePendingGraphSelectionStore.getState().request("missing0");
    render(<GitGraphTabContent />);
    await waitFor(() => expect(usePendingGraphSelectionStore.getState().hash).toBeNull());
    const callsAfterFirstGiveUp = vi.mocked(gitGraphLog).mock.calls.length;
    expect(callsAfterFirstGiveUp).toBeGreaterThan(1);

    vi.mocked(gitGraphLog)
      .mockResolvedValueOnce(commitList(["aaa1111"], true))
      .mockResolvedValueOnce(commitList(["aaa1111", "eee5555"], false));
    usePendingGraphSelectionStore.getState().request("eee5555");

    await waitFor(() => expect(screen.getAllByText("eee5555").length).toBeGreaterThan(0));
    expect(usePendingGraphSelectionStore.getState().hash).toBeNull();
  });

  it("does not burn retries or stack loads on re-renders while a page load is in flight", async () => {
    // Real git takes long enough that unrelated re-renders (search typing,
    // spinner state) happen while a retry's reload is pending. Each of those
    // re-renders must not count as another attempt — otherwise the 5-attempt
    // budget burns out and consumes the pending hash before git ever answers.
    let resolveSecond!: (value: ReturnType<typeof commitList>) => void;
    const second = new Promise<ReturnType<typeof commitList>>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(gitGraphLog)
      .mockResolvedValueOnce(commitList(["aaa1111"], true))
      .mockImplementation(() => second);

    render(<GitGraphTabContent />);
    await screen.findByText("msg aaa1111");

    usePendingGraphSelectionStore.getState().request("ccc3333");
    await waitFor(() => expect(vi.mocked(gitGraphLog)).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Search commits" }));
    fireEvent.change(screen.getByPlaceholderText("Search message, author, hash…"), {
      target: { value: "zzz" },
    });
    fireEvent.change(screen.getByPlaceholderText("Search message, author, hash…"), {
      target: { value: "" },
    });

    expect(vi.mocked(gitGraphLog)).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecond(commitList(["aaa1111", "ccc3333"], false));
    });

    await waitFor(() => expect(usePendingGraphSelectionStore.getState().hash).toBeNull());
    expect(screen.getAllByText("ccc3333").length).toBeGreaterThan(0);
  });
});

describe("GitGraphTabContent worktree selector wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePendingGraphSelectionStore.setState({ hash: null });
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("opens a terminal in the picked worktree instead of pointing the explorer at it", async () => {
    // `setRoot` reads as the tidy way to "switch to" a directory, but the
    // explorer root drives cwd sync, which types `cd <path>` into whatever
    // shell has focus — quite often a running agent, whose prompt then eats it.
    // Opening a terminal there gets the explorer to follow anyway.
    vi.mocked(gitGraphLog).mockResolvedValue(commitList(["aaa1111"], false));
    vi.mocked(gitWorktreeList).mockResolvedValue([
      { path: "/repo", branch: "master" },
      { path: "/repo-dev", branch: "feature" },
    ]);
    useTabsStore.setState({
      tabs: [],
      activeId: null,
      spaces: [{ id: "s1", name: "S" }],
      activeSpaceId: "s1",
    });

    render(<GitGraphTabContent />);
    fireEvent.click((await screen.findAllByLabelText("Worktree"))[0]);
    fireEvent.click(screen.getByText("repo-dev (feature)"));

    await waitFor(() => expect(useTabsStore.getState().tabs).toHaveLength(1));
    expect(useTabsStore.getState().tabs[0].cwd).toBe("/repo-dev");
    // The explorer is not repointed from here; the new pane does that itself.
    expect(useWorkspaceStore.getState().rootPath).toBe("/repo");
  });

  it("goes to the terminal already in that worktree rather than starting a second", async () => {
    vi.mocked(gitGraphLog).mockResolvedValue(commitList(["aaa1111"], false));
    vi.mocked(gitWorktreeList).mockResolvedValue([
      { path: "/repo", branch: "master" },
      { path: "/repo-dev", branch: "feature" },
    ]);
    useTabsStore.setState({
      tabs: [
        {
          id: "t9",
          spaceId: "s1",
          title: "t9",
          kind: "terminal",
          paneTree: leaf("p9", { kind: "terminal", cwd: "/repo-dev" }),
          activeLeafId: "p9",
          paneOrder: ["p9"],
        },
      ],
      activeId: null,
      spaces: [{ id: "s1", name: "S" }],
      activeSpaceId: "s1",
    });

    render(<GitGraphTabContent />);
    fireEvent.click((await screen.findAllByLabelText("Worktree"))[0]);
    fireEvent.click(screen.getByText("repo-dev (feature)"));

    await waitFor(() => expect(useTabsStore.getState().activeId).toBe("t9"));
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("hides the selector when listing worktrees fails", async () => {
    vi.mocked(gitGraphLog).mockResolvedValue(commitList(["aaa1111"], false));
    vi.mocked(gitWorktreeList).mockRejectedValue(new Error("not a repo"));

    render(<GitGraphTabContent />);
    await screen.findByText("msg aaa1111");

    expect(screen.queryByLabelText("Worktree")).not.toBeInTheDocument();
  });
});

describe("GitGraphTabContent compare mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitWorktreeList).mockResolvedValue([]);
    usePendingGraphSelectionStore.setState({ hash: null });
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("shift-clicking a second commit shows the compare header, and a plain click collapses back", async () => {
    vi.mocked(gitGraphLog).mockImplementation(async () =>
      commitList(["aaa1111", "bbb2222"], false),
    );

    render(<GitGraphTabContent />);
    await waitFor(() => screen.getByText("msg aaa1111"));

    const rowA = screen.getByText("msg aaa1111").closest("div[class*='absolute']")!;
    const rowB = screen.getByText("msg bbb2222").closest("div[class*='absolute']")!;

    fireEvent.click(rowA);
    fireEvent.click(rowB, { shiftKey: true });

    // aaa1111 is the newer commit (index 0), bbb2222 the older one (index 1):
    // from (older) .. to (newer).
    await waitFor(() => expect(screen.getByText("bbb2222 .. aaa1111")).toBeInTheDocument());

    fireEvent.click(rowA);

    await waitFor(() => expect(screen.getAllByText("aaa1111").length).toBeGreaterThan(0));
    expect(screen.queryByText("bbb2222 .. aaa1111")).not.toBeInTheDocument();
  });

  it("does not refetch commit details when clicking the already-selected commit again", async () => {
    vi.mocked(gitGraphLog).mockImplementation(async () =>
      commitList(["aaa1111", "bbb2222"], false),
    );

    render(<GitGraphTabContent />);
    await waitFor(() => screen.getByText("msg aaa1111"));

    const rowA = screen.getByText("msg aaa1111").closest("div[class*='absolute']")!;

    fireEvent.click(rowA);
    await waitFor(() => expect(gitCommitDetails).toHaveBeenCalledTimes(1));

    fireEvent.click(rowA);

    // React bails out of re-rendering when a functional setState update
    // returns the previous state by reference, so no new effect run (and
    // no second fetch) is even scheduled — safe to assert synchronously.
    expect(gitCommitDetails).toHaveBeenCalledTimes(1);
  });

  it("falls back to a single selection when the shift-click anchor is no longer in a freshly reloaded commit list", async () => {
    vi.mocked(gitGraphLog)
      .mockResolvedValueOnce(commitList(["aaa1111", "bbb2222"], false))
      .mockResolvedValueOnce(commitList(["ccc3333", "bbb2222"], false));

    render(<GitGraphTabContent />);
    await waitFor(() => screen.getByText("msg aaa1111"));

    const rowA = screen.getByText("msg aaa1111").closest("div[class*='absolute']")!;
    fireEvent.click(rowA);

    // Simulate the repo changing underneath the stale selection (e.g. a
    // branch switch): the reload drops aaa1111 out of the list entirely.
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => screen.getByText("msg ccc3333"));
    expect(screen.queryByText("msg aaa1111")).not.toBeInTheDocument();

    const rowB = screen.getByText("msg bbb2222").closest("div[class*='absolute']")!;
    fireEvent.click(rowB, { shiftKey: true });

    // The stale anchor's index can't be found (-1), so this must collapse to
    // a plain single selection on bbb2222 instead of an arbitrarily-ordered
    // compare pair.
    await waitFor(() => expect(screen.getAllByText("bbb2222").length).toBeGreaterThan(0));
    expect(screen.queryByText(/ \.\. /)).not.toBeInTheDocument();
  });
});
