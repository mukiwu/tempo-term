import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitGraphToolbar, type GitGraphToolbarLabels } from "./GitGraphToolbar";
import type { Branch } from "./types";

// jsdom's ResizeObserver is a no-op, so swap in a controllable one that lets a
// test feed a width through the same callback the component listens on. This
// exercises the real measure -> isCompact path through the public component.
type ResizeCallback = (entries: ResizeObserverEntry[], obs: ResizeObserver) => void;
let observers: ResizeCallback[] = [];

class ControllableResizeObserver {
  constructor(private cb: ResizeCallback) {
    observers.push(this.cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function setToolbarWidth(width: number) {
  act(() => {
    for (const cb of observers) {
      cb(
        [{ contentRect: { width } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    }
  });
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal("ResizeObserver", ControllableResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const labels: GitGraphToolbarLabels = {
  branches: "Branches",
  showAll: "Show All",
  filterPlaceholder: "Search branches",
  currentBadge: "current",
  showRemoteBranches: "Show Remote Branches",
  search: "Search commits",
  searchPlaceholder: "Search message, author, hash",
  displayOptions: "Display options",
  showTags: "Show Tags",
  showStashes: "Show Stashes",
  refresh: "Refresh",
  fetch: "Fetch",
  fetching: "Fetching",
  matches: "{{count}} matches",
  head: "HEAD",
  more: "More",
  commitOrder: "Commit order",
  orderDate: "Date order",
  orderTopo: "Topological order",
  worktree: "Worktree",
  switchBranch: "Switch Branch",
};

const branches: Branch[] = [
  { name: "master", isRemote: false } as Branch,
  { name: "dev", isRemote: false } as Branch,
  { name: "origin/master", isRemote: true } as Branch,
];

function renderToolbar(overrides: Partial<Parameters<typeof GitGraphToolbar>[0]> = {}) {
  const props = {
    branches,
    selectedBranches: [] as string[],
    onSelectBranches: vi.fn(),
    includeRemotes: false,
    onToggleRemotes: vi.fn(),
    includeTags: false,
    onToggleTags: vi.fn(),
    includeStashes: false,
    onToggleStashes: vi.fn(),
    commitOrder: "date" as const,
    onChangeOrder: vi.fn(),
    searchQuery: "",
    onSearchChange: vi.fn(),
    matchCount: 0,
    onRefresh: vi.fn(),
    onFetch: vi.fn(),
    fetching: false,
    refreshing: false,
    currentBranch: "master",
    worktrees: [],
    currentWorktreePath: null,
    onSelectWorktree: vi.fn(),
    onCheckoutBranch: vi.fn(),
    onCheckoutRemoteBranch: vi.fn(),
    labels,
    ...overrides,
  };
  render(<GitGraphToolbar {...props} />);
  return props;
}

describe("GitGraphToolbar responsive layout", () => {
  it("collapses the action icons into an overflow menu when the toolbar is narrow", () => {
    renderToolbar();

    // Roomy by default: inline refresh icon present, no overflow button.
    expect(screen.getByLabelText(labels.refresh)).toBeInTheDocument();
    expect(screen.queryByLabelText(labels.more)).not.toBeInTheDocument();

    setToolbarWidth(360);

    // Compact: the icon cluster is replaced by a single overflow button.
    expect(screen.getByLabelText(labels.more)).toBeInTheDocument();
    expect(screen.queryByLabelText(labels.refresh)).not.toBeInTheDocument();
  });

  it("keeps the branch dropdown and search reachable when compact", () => {
    renderToolbar();
    setToolbarWidth(360);

    expect(screen.getAllByLabelText(labels.branches).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(labels.search)).toBeInTheDocument();
  });

  it("exposes head info, refresh, fetch and all toggles inside the overflow menu", () => {
    renderToolbar({ currentBranch: "feature/x" });
    setToolbarWidth(360);

    fireEvent.click(screen.getByLabelText(labels.more));

    expect(screen.getByText(`${labels.head}: feature/x`)).toBeInTheDocument();
    expect(screen.getByText(labels.refresh)).toBeInTheDocument();
    expect(screen.getByText(labels.fetch)).toBeInTheDocument();
    expect(screen.getByText(labels.showRemoteBranches)).toBeInTheDocument();
    expect(screen.getByText(labels.showTags)).toBeInTheDocument();
    expect(screen.getByText(labels.showStashes)).toBeInTheDocument();
  });

  it("invokes the same callbacks when actions and toggles are used from the overflow menu", () => {
    const props = renderToolbar();
    setToolbarWidth(360);
    fireEvent.click(screen.getByLabelText(labels.more));

    fireEvent.click(screen.getByText(labels.refresh));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText(labels.more));
    fireEvent.click(screen.getByText(labels.fetch));
    expect(props.onFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText(labels.more));
    fireEvent.click(screen.getByText(labels.showRemoteBranches));
    expect(props.onToggleRemotes).toHaveBeenCalledWith(true);
  });

  it("hides the branch dropdown while searching in compact mode and restores it on close", () => {
    renderToolbar();
    setToolbarWidth(360);

    fireEvent.click(screen.getByLabelText(labels.search));
    expect(screen.queryByLabelText(labels.branches)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(labels.search));
    expect(screen.getAllByLabelText(labels.branches).length).toBeGreaterThan(0);
  });

  it("spins and disables the refresh control while a reload is in flight (roomy)", () => {
    renderToolbar({ refreshing: true });

    const button = screen.getByLabelText(labels.refresh);
    expect(button).toBeDisabled();
    expect(button.querySelector(".animate-spin")).not.toBeNull();
  });

  it("spins and disables the refresh row while a reload is in flight (compact)", () => {
    renderToolbar({ refreshing: true });
    setToolbarWidth(360);
    fireEvent.click(screen.getByLabelText(labels.more));

    const row = screen.getByText(labels.refresh).closest("button");
    expect(row).toBeDisabled();
    expect(row?.querySelector(".animate-spin")).not.toBeNull();
  });
});

describe("GitGraphToolbar commit ordering", () => {
  it("changes the order from the display-options popover (roomy)", () => {
    const props = renderToolbar({ commitOrder: "date" });

    fireEvent.click(screen.getByLabelText(labels.displayOptions));

    expect(screen.getByText(labels.orderDate)).toBeInTheDocument();
    fireEvent.click(screen.getByText(labels.orderTopo));
    expect(props.onChangeOrder).toHaveBeenCalledWith("topo");
  });

  it("marks the active order so the current choice is visible", () => {
    renderToolbar({ commitOrder: "topo" });

    fireEvent.click(screen.getByLabelText(labels.displayOptions));

    expect(screen.getByRole("radio", { name: labels.orderTopo })).toBeChecked();
    expect(screen.getByRole("radio", { name: labels.orderDate })).not.toBeChecked();
  });

  it("groups the order options as a labelled radiogroup for screen readers", () => {
    renderToolbar({ commitOrder: "date" });

    fireEvent.click(screen.getByLabelText(labels.displayOptions));

    const group = screen.getByRole("radiogroup", { name: labels.commitOrder });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
  });

  it("changes the order from the overflow menu (compact)", () => {
    const props = renderToolbar({ commitOrder: "date" });
    setToolbarWidth(360);
    fireEvent.click(screen.getByLabelText(labels.more));

    fireEvent.click(screen.getByText(labels.orderTopo));
    expect(props.onChangeOrder).toHaveBeenCalledWith("topo");
  });
});

describe("GitGraphToolbar worktree selector", () => {
  const twoWorktrees = [
    { path: "/repos/app", branch: "master" },
    { path: "/repos/app-dev", branch: "feature" },
  ];

  it("is hidden when the repo has a single worktree", () => {
    renderToolbar({
      worktrees: [{ path: "/repos/app", branch: "master" }],
      currentWorktreePath: "/repos/app",
    });

    expect(screen.queryByText(`${labels.worktree}:`)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(labels.worktree)).not.toBeInTheDocument();
  });

  it("shows the current worktree as the selected value when there are several", () => {
    renderToolbar({ worktrees: twoWorktrees, currentWorktreePath: "/repos/app" });

    expect(screen.getByText(`${labels.worktree}:`)).toBeInTheDocument();
    expect(screen.getAllByLabelText(labels.worktree)[0]).toHaveTextContent("app (master)");
  });

  it("selecting another worktree reports its path", () => {
    const props = renderToolbar({
      worktrees: twoWorktrees,
      currentWorktreePath: "/repos/app",
    });

    fireEvent.click(screen.getAllByLabelText(labels.worktree)[0]);
    fireEvent.click(screen.getByText("app-dev (feature)"));

    expect(props.onSelectWorktree).toHaveBeenCalledWith("/repos/app-dev");
  });

  it("re-picking the current worktree does not fire a switch", () => {
    const props = renderToolbar({
      worktrees: twoWorktrees,
      currentWorktreePath: "/repos/app",
    });

    fireEvent.click(screen.getAllByLabelText(labels.worktree)[0]);
    fireEvent.click(screen.getByRole("button", { name: /app \(master\)/ }));

    expect(props.onSelectWorktree).not.toHaveBeenCalled();
  });

  it("matches the current worktree across mixed slash directions (Windows)", () => {
    const props = renderToolbar({
      worktrees: [
        { path: "C:\\repos\\app", branch: "master" },
        { path: "C:\\repos\\app-dev", branch: "feature" },
      ],
      // resolve_repo / system APIs may hand back forward slashes for the
      // same directory git printed with backslashes.
      currentWorktreePath: "C:/repos/app",
    });

    expect(screen.getAllByLabelText(labels.worktree)[0]).toHaveTextContent("app (master)");

    // Re-picking the current worktree must be recognized as current — no
    // redundant workspace switch.
    fireEvent.click(screen.getAllByLabelText(labels.worktree)[0]);
    fireEvent.click(screen.getByRole("button", { name: /app \(master\)/ }));
    expect(props.onSelectWorktree).not.toHaveBeenCalled();
  });

  it("falls back to full paths when two labels would collide", () => {
    renderToolbar({
      worktrees: [
        { path: "/a/repo", branch: "main" },
        { path: "/b/repo", branch: "main" },
      ],
      currentWorktreePath: "/a/repo",
    });

    expect(screen.getAllByLabelText(labels.worktree)[0]).toHaveTextContent("/a/repo");
  });
});

describe("GitGraphToolbar branch filter", () => {
  function openFilter() {
    fireEvent.click(screen.getAllByLabelText(labels.branches)[0]);
  }

  it("shows Show All on the trigger when nothing is picked", () => {
    renderToolbar();
    expect(screen.getAllByLabelText(labels.branches)[0]).toHaveTextContent(labels.showAll);
  });

  it("summarizes multiple picks as the first name plus a count", () => {
    renderToolbar({ selectedBranches: ["master", "dev"] });
    expect(screen.getAllByLabelText(labels.branches)[0]).toHaveTextContent("master +1");
  });

  it("toggles a branch into the selection without closing the list", () => {
    const props = renderToolbar({ selectedBranches: ["master"] });
    openFilter();

    fireEvent.click(screen.getByRole("option", { name: "dev" }));
    expect(props.onSelectBranches).toHaveBeenCalledWith(["master", "dev"]);
    // Multi-select keeps the list open for further picks.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("toggles an already-picked branch back out", () => {
    const props = renderToolbar({ selectedBranches: ["master", "dev"] });
    openFilter();

    fireEvent.click(screen.getByRole("option", { name: "dev" }));
    expect(props.onSelectBranches).toHaveBeenCalledWith(["master"]);
  });

  it("Show All is exclusive: it clears the picks and closes the list", () => {
    const props = renderToolbar({ selectedBranches: ["master", "dev"] });
    openFilter();

    fireEvent.click(screen.getByRole("option", { name: labels.showAll }));
    expect(props.onSelectBranches).toHaveBeenCalledWith([]);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("filters the branch list as the search box is typed into", () => {
    renderToolbar({ includeRemotes: true });
    openFilter();

    fireEvent.change(screen.getByPlaceholderText(labels.filterPlaceholder), {
      target: { value: "dev" },
    });

    expect(screen.getByRole("option", { name: "dev" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "master" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "origin/master" })).not.toBeInTheDocument();
  });

  it("lists remote branches only while Show Remote Branches is on", () => {
    renderToolbar({ includeRemotes: false });
    openFilter();

    // The default currentBranch is "master", so its row carries the current badge.
    expect(
      screen.getByRole("option", { name: `master ${labels.currentBadge}` }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "origin/master" })).not.toBeInTheDocument();
  });

  it("marks the checked-out branch with a current badge", () => {
    renderToolbar({ currentBranch: "dev" });
    openFilter();

    const row = screen.getByRole("option", { name: `dev ${labels.currentBadge}` });
    expect(within(row).getByText(labels.currentBadge)).toBeInTheDocument();
    // The others carry no badge.
    expect(screen.getByRole("option", { name: "master" })).toBeInTheDocument();
  });

  it("orders the branch list by most recent commit first", () => {
    renderToolbar({
      branches: [
        { name: "old-branch", isRemote: false, lastCommitAt: 100 } as Branch,
        { name: "fresh-branch", isRemote: false, lastCommitAt: 900 } as Branch,
        { name: "mid-branch", isRemote: false, lastCommitAt: 500 } as Branch,
      ],
    });
    openFilter();

    const names = screen
      .getAllByRole("option")
      .map((o) => o.textContent?.trim())
      .filter((n) => n !== labels.showAll);
    expect(names).toEqual(["fresh-branch", "mid-branch", "old-branch"]);
  });

  it("marks picked branches and Show All with their selected state", () => {
    renderToolbar({ selectedBranches: ["dev"] });
    openFilter();

    expect(screen.getByRole("option", { name: "dev" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: labels.showAll })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

describe("GitGraphToolbar branch-switch menu", () => {
  it("opens from the HEAD button and lists local branches with the current one checked", () => {
    renderToolbar({ currentBranch: "master" });

    fireEvent.click(screen.getByRole("button", { name: /Switch Branch/ }));

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("master")).toBeInTheDocument();
    expect(within(menu).getByText("dev")).toBeInTheDocument();
    expect(within(menu).getByText("origin/master")).toBeInTheDocument();
  });

  it("clicking another local branch checks it out and closes the menu", () => {
    const props = renderToolbar({ currentBranch: "master" });

    fireEvent.click(screen.getByRole("button", { name: /Switch Branch/ }));
    fireEvent.click(within(screen.getByRole("menu")).getByText("dev"));

    expect(props.onCheckoutBranch).toHaveBeenCalledWith("dev");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("clicking the current branch closes without checking out", () => {
    const props = renderToolbar({ currentBranch: "master" });

    fireEvent.click(screen.getByRole("button", { name: /Switch Branch/ }));
    fireEvent.click(within(screen.getByRole("menu")).getByText("master"));

    expect(props.onCheckoutBranch).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("clicking a remote branch routes to the tracking flow", () => {
    const props = renderToolbar({ currentBranch: "master" });

    fireEvent.click(screen.getByRole("button", { name: /Switch Branch/ }));
    fireEvent.click(within(screen.getByRole("menu")).getByText("origin/master"));

    expect(props.onCheckoutRemoteBranch).toHaveBeenCalledWith("origin/master");
  });

  it("compact mode reaches the same menu through the overflow HEAD row", () => {
    const props = renderToolbar({ currentBranch: "master" });
    setToolbarWidth(360);

    fireEvent.click(screen.getByLabelText(labels.more));
    fireEvent.click(screen.getByRole("button", { name: /Switch Branch/ }));
    fireEvent.click(within(screen.getByRole("menu")).getByText("dev"));

    expect(props.onCheckoutBranch).toHaveBeenCalledWith("dev");
  });
});

describe("GitGraphToolbar branch-switch menu guards", () => {
  it("announces the current branch in the HEAD button's accessible name", () => {
    renderToolbar({ currentBranch: "master" });

    expect(
      screen.getByRole("button", { name: "Switch Branch (HEAD: master)" }),
    ).toBeInTheDocument();
  });

  it("disables the HEAD button while the branch list is empty", () => {
    renderToolbar({ branches: [] });

    expect(screen.getByRole("button", { name: /Switch Branch/ })).toBeDisabled();
  });

  it("disables a local branch that another worktree has checked out", () => {
    const props = renderToolbar({
      currentBranch: "master",
      branches: [
        { name: "master", isRemote: false } as Branch,
        { name: "feature", isRemote: false } as Branch,
      ],
      worktrees: [
        { path: "/repos/app", branch: "master" },
        { path: "/repos/app-dev", branch: "feature" },
      ],
      currentWorktreePath: "/repos/app",
    });

    fireEvent.click(screen.getByRole("button", { name: /Switch Branch/ }));
    const entry = within(screen.getByRole("menu")).getByText("feature").closest("button");
    expect(entry).toBeDisabled();

    fireEvent.click(within(screen.getByRole("menu")).getByText("feature"));
    expect(props.onCheckoutBranch).not.toHaveBeenCalled();
  });
});
