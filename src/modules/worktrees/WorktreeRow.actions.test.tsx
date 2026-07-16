import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { gitWorktreeDirtyCount } = vi.hoisted(() => ({ gitWorktreeDirtyCount: vi.fn() }));
vi.mock("./lib/worktreesBridge", () => ({ gitWorktreeDirtyCount }));

import "@/i18n";
import { computeLayout, leaf, type LayoutNode } from "@/modules/terminal/lib/terminalLayout";
import { MAX_PANES, useTabsStore, type Tab } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import type { WorktreeDetail } from "./types";
import { WorktreeRow } from "./WorktreeRow";

const WT = "/code/repo-worktrees/feat-a";

function detail(overrides: Partial<WorktreeDetail> = {}): WorktreeDetail {
  return {
    path: WT,
    branch: "feat/a",
    head: "abc",
    isMain: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    ...overrides,
  };
}

function tab(id: string, paneTree: LayoutNode, paneOrder: string[], cwd?: string): Tab {
  return {
    id,
    spaceId: "s1",
    title: id,
    kind: "terminal",
    paneTree,
    activeLeafId: paneOrder[0],
    paneOrder,
    cwd,
  };
}

function seedTabs(tabs: Tab[], activeId: string | null) {
  useTabsStore.setState({
    tabs,
    activeId,
    spaces: [{ id: "s1", name: "S" }],
    activeSpaceId: "s1",
  });
}

/** Every terminal pane's cwd across every tab — what actually got opened where. */
function terminalCwds(): string[] {
  return useTabsStore
    .getState()
    .tabs.flatMap((t) =>
      computeLayout(t.paneTree)
        .filter((p) => p.content?.kind === "terminal")
        .map((p) => (p.content as { cwd?: string }).cwd ?? t.cwd ?? ""),
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  gitWorktreeDirtyCount.mockResolvedValue(0);
  useUiStore.setState({ worktreesModal: { scope: "global", repoPath: null } });
  seedTabs([tab("t1", leaf("p1", { kind: "terminal", cwd: "/elsewhere" }), ["p1"])], "t1");
});

const openButton = () => screen.getByRole("button", { name: /open/i });
const splitButton = () => screen.getByRole("button", { name: /split/i });

describe("WorktreeRow — opening", () => {
  it("spawns a terminal in the worktree when nothing is there yet", () => {
    render(<WorktreeRow detail={detail()} />);

    fireEvent.click(openButton());

    expect(terminalCwds()).toContain(WT);
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("focuses the tab already in the worktree instead of spawning a second shell", () => {
    seedTabs(
      [
        tab("t1", leaf("p1", { kind: "terminal", cwd: "/elsewhere" }), ["p1"]),
        tab("t2", leaf("p2", { kind: "terminal", cwd: `${WT}/src` }), ["p2"]),
      ],
      "t1",
    );

    render(<WorktreeRow detail={detail()} />);
    fireEvent.click(openButton());

    expect(useTabsStore.getState().activeId).toBe("t2");
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("closes the manager once it has taken you somewhere", () => {
    render(<WorktreeRow detail={detail()} />);

    fireEvent.click(openButton());

    expect(useUiStore.getState().worktreesModal).toBeNull();
  });

  it("will not open a worktree whose directory is gone", () => {
    render(<WorktreeRow detail={detail({ prunable: true })} />);

    expect(openButton()).toBeDisabled();
  });
});

describe("WorktreeRow — splitting", () => {
  it("puts the worktree beside the pane you were in", () => {
    render(<WorktreeRow detail={detail()} />);

    fireEvent.click(splitButton());

    const active = useTabsStore.getState().tabs.find((t) => t.id === "t1")!;
    expect(active.paneOrder).toHaveLength(2);
    expect(terminalCwds()).toContain(WT);
    // Split means beside what you had — not a new tab.
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("refuses to split a tab that is already full", () => {
    const panes = Array.from({ length: MAX_PANES }, (_, i) => `p${i}`);
    seedTabs([tab("t1", leaf("p0", { kind: "terminal", cwd: "/elsewhere" }), panes)], "t1");

    render(<WorktreeRow detail={detail()} />);

    expect(splitButton()).toBeDisabled();
  });

  it("offers no split when there is nothing to split", () => {
    seedTabs([], null);

    render(<WorktreeRow detail={detail()} />);

    expect(screen.queryByRole("button", { name: /split/i })).not.toBeInTheDocument();
  });

  it("offers no split into a launcher tab, whose panes are never rendered", () => {
    const launcher = tab("t1", leaf("p1", { kind: "launcher" }), ["p1"]);
    seedTabs([{ ...launcher, kind: "launcher" }], "t1");

    render(<WorktreeRow detail={detail()} />);

    expect(screen.queryByRole("button", { name: /split/i })).not.toBeInTheDocument();
  });

  it("still opens into a tab of its own from a launcher tab", () => {
    const launcher = tab("t1", leaf("p1", { kind: "launcher" }), ["p1"]);
    seedTabs([{ ...launcher, kind: "launcher" }], "t1");

    render(<WorktreeRow detail={detail()} />);
    fireEvent.click(openButton());

    expect(terminalCwds()).toContain(WT);
  });
});
