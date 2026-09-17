import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitGraphToolbar, type GitGraphToolbarLabels } from "./GitGraphToolbar";
import type { Branch } from "./types";
import { useGraphSearchRequestStore } from "./lib/graphSearchRequestStore";

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
  useGraphSearchRequestStore.setState({ token: 0 });
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
  closeSearch: "Close search",
  searchPlaceholder: "Search message, author, hash",
  displayOptions: "Display options",
  showTags: "Show Tags",
  showStashes: "Show Stashes",
  refresh: "Refresh",
  fetch: "Fetch",
  fetching: "Fetching",
  matches: "{{current}} / {{count}} matches (loaded)",
  matchesShort: "{{current}} / {{count}}",
  previousMatch: "Previous match",
  nextMatch: "Next match",
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

/** Renders, then hands back a way to change what is in the search box. The
 *  toolbar owns whether the box is open, the parent owns what is typed in it,
 *  so a test about typing has to come in through props. */
function renderToolbarForRerender(
  overrides: Partial<Parameters<typeof GitGraphToolbar>[0]> = {},
) {
  const props = toolbarProps(overrides);
  const { rerender } = render(<GitGraphToolbar {...props} />);
  return {
    props,
    rerender: (searchQuery: string) =>
      rerender(<GitGraphToolbar {...props} searchQuery={searchQuery} />),
  };
}

function renderToolbar(overrides: Partial<Parameters<typeof GitGraphToolbar>[0]> = {}) {
  const props = toolbarProps(overrides);
  render(<GitGraphToolbar {...props} />);
  return props;
}

function toolbarProps(overrides: Partial<Parameters<typeof GitGraphToolbar>[0]> = {}) {
  return {
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
    matchPosition: 0,
    matchCount: 0,
    onNavigateMatch: vi.fn(),
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

  it("keeps the branch controls while searching at a width that fits both", () => {
    renderToolbar();
    // The branch combobox has its own searchOpen term, so it must not also be
    // charged the search's width: doing both took it away here, where the row
    // has room for it and the search box together.
    setToolbarWidth(700);

    fireEvent.click(screen.getByLabelText(labels.search));

    expect(screen.getAllByLabelText(labels.branches).length).toBeGreaterThan(0);
  });

  it("opens the search box when the shortcut asks for it", () => {
    renderToolbar();
    expect(screen.queryByPlaceholderText(labels.searchPlaceholder)).not.toBeInTheDocument();

    act(() => useGraphSearchRequestStore.getState().open());

    expect(screen.getByPlaceholderText(labels.searchPlaceholder)).toBeInTheDocument();
  });

  it("does not reopen a closed box for a request that predates the toolbar", () => {
    // The store outlives any one toolbar. Mounting after a press must not act
    // on it — the graph would pop its search open on every remount.
    act(() => useGraphSearchRequestStore.getState().open());
    renderToolbar();

    expect(screen.queryByPlaceholderText(labels.searchPlaceholder)).not.toBeInTheDocument();
  });

  it("names the button that closes the search for what it does", () => {
    renderToolbar();
    fireEvent.click(screen.getByLabelText(labels.search));

    // Not "Search commits" again: that button opens the box, this one closes it.
    expect(screen.getByLabelText(labels.closeSearch)).toBeInTheDocument();
    expect(screen.queryByLabelText(labels.search)).not.toBeInTheDocument();
  });

  it("leaves the row alone for an empty search box that already fits", () => {
    renderToolbar();
    // Wide enough for the roomy row and an empty search box beside it. Charging
    // the box what a box with a query in it costs folded the remote toggle away
    // and left the gap it used to sit in.
    setToolbarWidth(900);
    fireEvent.click(screen.getByLabelText(labels.search));

    expect(screen.getByLabelText(labels.refresh)).toBeInTheDocument();
    expect(screen.getByText(labels.showRemoteBranches)).toBeInTheDocument();
  });

  it("keeps the row alone once a query is typed into that box too", () => {
    const { rerender } = renderToolbarForRerender();
    setToolbarWidth(1000);
    fireEvent.click(screen.getByLabelText(labels.search));

    rerender("abc");

    // Typing adds the counts and the two step buttons, but the counts stay
    // short, so what appears fits in the room the box was already charged for.
    expect(screen.getByLabelText(labels.refresh)).toBeInTheDocument();
    expect(screen.getByText(labels.showRemoteBranches)).toBeInTheDocument();
  });

  it("charges an open search against the width the rest of the row gets", () => {
    renderToolbar();
    // Wide enough for the roomy row, but not for the roomy row plus a search
    // box. Before the search was charged for, the row stayed roomy here and the
    // icon buttons were squeezed narrower than the icons inside them.
    setToolbarWidth(700);
    expect(screen.getByLabelText(labels.refresh)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(labels.search));

    expect(screen.getByLabelText(labels.more)).toBeInTheDocument();
    expect(screen.queryByLabelText(labels.refresh)).not.toBeInTheDocument();
  });

  it("gives the row back when the search closes", () => {
    renderToolbar();
    setToolbarWidth(700);
    fireEvent.click(screen.getByLabelText(labels.search));
    expect(screen.queryByLabelText(labels.refresh)).not.toBeInTheDocument();

    // The X and Escape are the two ways out; both go through closeSearch.
    fireEvent.keyDown(screen.getByPlaceholderText(labels.searchPlaceholder), {
      key: "Escape",
    });

    expect(screen.getByLabelText(labels.refresh)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(labels.searchPlaceholder)).not.toBeInTheDocument();
  });

  it("shows the match counts alone and keeps the sentence for the tooltip", () => {
    renderToolbar({ searchQuery: "abc", matchPosition: 3, matchCount: 12 });
    fireEvent.click(screen.getByLabelText(labels.search));

    // Spelling it out on the row costs about what the remote toggle beside it
    // costs, and it is read once where the numbers are read every keystroke.
    expect(screen.getByText("3 / 12")).toBeInTheDocument();
    expect(screen.queryByText("3 / 12 matches (loaded)")).not.toBeInTheDocument();
  });

  it("drops the HEAD button before compact, and the overflow menu carries it again", () => {
    renderToolbar({ currentBranch: "feature/x" });
    const switchLabel = `${labels.switchBranch} (${labels.head}: feature/x)`;

    setToolbarWidth(1200);
    expect(screen.getByRole("button", { name: switchLabel })).toBeInTheDocument();

    // Gone well before the full compact fold: right-clicking a branch chip in
    // the graph already offers checkout, so nothing here is the only way in.
    setToolbarWidth(800);
    expect(screen.queryByRole("button", { name: switchLabel })).not.toBeInTheDocument();

    setToolbarWidth(360);
    fireEvent.click(screen.getByLabelText(labels.more));
    expect(screen.getByText(`${labels.head}: feature/x`)).toBeInTheDocument();
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

  it("keeps the branch dropdown while searching, however narrow the row is", () => {
    renderToolbar();
    setToolbarWidth(360);

    fireEvent.click(screen.getByLabelText(labels.search));

    // It used to step aside here. What it gave up was on the opposite end of
    // the row from the box that wanted it, so all that bought was a hole —
    // and it took away the control most likely to be reached for next.
    expect(screen.getAllByLabelText(labels.branches).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText(labels.closeSearch));
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

  it("steps aside on a narrow row, where the worktree manager still opens them", () => {
    renderToolbar({ worktrees: twoWorktrees, currentWorktreePath: "/repos/app" });

    setToolbarWidth(1200);
    expect(screen.getAllByLabelText(labels.worktree).length).toBeGreaterThan(0);

    // "<folder> (<branch>)" is the widest thing on the row, so it gives way
    // first — long before the row would actually break.
    setToolbarWidth(900);
    expect(screen.queryByLabelText(labels.worktree)).not.toBeInTheDocument();
    expect(screen.queryByText(`${labels.worktree}:`)).not.toBeInTheDocument();
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
