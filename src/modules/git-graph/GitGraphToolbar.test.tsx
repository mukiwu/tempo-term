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
};

const branches: Branch[] = [
  { name: "master", isRemote: false } as Branch,
  { name: "origin/master", isRemote: true } as Branch,
];

function renderToolbar(overrides: Partial<Parameters<typeof GitGraphToolbar>[0]> = {}) {
  const props = {
    branches,
    selectedBranch: null,
    onSelectBranch: vi.fn(),
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
    expect(screen.getByTitle(labels.refresh)).toBeInTheDocument();
    expect(screen.queryByTitle(labels.more)).not.toBeInTheDocument();

    setToolbarWidth(360);

    // Compact: the icon cluster is replaced by a single overflow button.
    expect(screen.getByTitle(labels.more)).toBeInTheDocument();
    expect(screen.queryByTitle(labels.refresh)).not.toBeInTheDocument();
  });

  it("keeps the branch dropdown and search reachable when compact", () => {
    renderToolbar();
    setToolbarWidth(360);

    expect(screen.getAllByLabelText(labels.branches).length).toBeGreaterThan(0);
    expect(screen.getByTitle(labels.search)).toBeInTheDocument();
  });

  it("exposes head info, refresh, fetch and all toggles inside the overflow menu", () => {
    renderToolbar({ currentBranch: "feature/x" });
    setToolbarWidth(360);

    fireEvent.click(screen.getByTitle(labels.more));

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
    fireEvent.click(screen.getByTitle(labels.more));

    fireEvent.click(screen.getByText(labels.refresh));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle(labels.more));
    fireEvent.click(screen.getByText(labels.fetch));
    expect(props.onFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle(labels.more));
    fireEvent.click(screen.getByText(labels.showRemoteBranches));
    expect(props.onToggleRemotes).toHaveBeenCalledWith(true);
  });

  it("hides the branch dropdown while searching in compact mode and restores it on close", () => {
    renderToolbar();
    setToolbarWidth(360);

    fireEvent.click(screen.getByTitle(labels.search));
    expect(screen.queryByLabelText(labels.branches)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle(labels.search));
    expect(screen.getAllByLabelText(labels.branches).length).toBeGreaterThan(0);
  });

  it("spins and disables the refresh control while a reload is in flight (roomy)", () => {
    renderToolbar({ refreshing: true });

    const button = screen.getByTitle(labels.refresh);
    expect(button).toBeDisabled();
    expect(button.querySelector(".animate-spin")).not.toBeNull();
  });

  it("spins and disables the refresh row while a reload is in flight (compact)", () => {
    renderToolbar({ refreshing: true });
    setToolbarWidth(360);
    fireEvent.click(screen.getByTitle(labels.more));

    const row = screen.getByText(labels.refresh).closest("button");
    expect(row).toBeDisabled();
    expect(row?.querySelector(".animate-spin")).not.toBeNull();
  });
});

describe("GitGraphToolbar commit ordering", () => {
  it("changes the order from the display-options popover (roomy)", () => {
    const props = renderToolbar({ commitOrder: "date" });

    fireEvent.click(screen.getByTitle(labels.displayOptions));

    expect(screen.getByText(labels.orderDate)).toBeInTheDocument();
    fireEvent.click(screen.getByText(labels.orderTopo));
    expect(props.onChangeOrder).toHaveBeenCalledWith("topo");
  });

  it("marks the active order so the current choice is visible", () => {
    renderToolbar({ commitOrder: "topo" });

    fireEvent.click(screen.getByTitle(labels.displayOptions));

    expect(screen.getByRole("radio", { name: labels.orderTopo })).toBeChecked();
    expect(screen.getByRole("radio", { name: labels.orderDate })).not.toBeChecked();
  });

  it("groups the order options as a labelled radiogroup for screen readers", () => {
    renderToolbar({ commitOrder: "date" });

    fireEvent.click(screen.getByTitle(labels.displayOptions));

    const group = screen.getByRole("radiogroup", { name: labels.commitOrder });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
  });

  it("changes the order from the overflow menu (compact)", () => {
    const props = renderToolbar({ commitOrder: "date" });
    setToolbarWidth(360);
    fireEvent.click(screen.getByTitle(labels.more));

    fireEvent.click(screen.getByText(labels.orderTopo));
    expect(props.onChangeOrder).toHaveBeenCalledWith("topo");
  });
});
