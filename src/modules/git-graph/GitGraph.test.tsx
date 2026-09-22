import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitGraph } from "./GitGraph";
import { DEFAULT_GEOMETRY, laneX } from "./lib/graphLayout";
import { usePendingGraphSelectionStore } from "./lib/pendingGraphSelectionStore";
import type { CommitNode } from "./types";

/** Node buttons are positioned by their centre less the radius plus a 2px ring. */
const NODE_OFFSET = 8;

const LABELS = {
  emptyTitle: "No commits",
  emptyHint: "",
  loadMore: "Load more",
  refHint: "{{name}}",
} as never;

function commit(hash: string, parents: string[], message = hash): CommitNode {
  return { hash, parents, author: "a", date: "today", message, refs: [] };
}

function container(text: string): HTMLElement {
  return screen.getByText(text).closest("div.flex-1.overflow-auto") as HTMLElement;
}

describe("GitGraph row click area", () => {
  const COMMIT = commit("abc1234", [], "feat: x");

  it("selects the commit when clicking the row, including the lane gutter area", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph commits={[COMMIT]} selection={null} onSelectCommit={onSelect} labels={LABELS} />,
    );

    const row = screen.getByText("feat: x").closest("div[class*='absolute']");
    expect(row).not.toBeNull();
    // The row must span from the container's left edge so clicks beside the
    // node dot (in the lane gutter) still open the commit detail.
    expect(row!.className).toContain("left-0");
    fireEvent.click(row!);
    expect(onSelect).toHaveBeenCalledWith(COMMIT, { shiftKey: false });
  });

  it("passes shiftKey through to onSelectCommit for compare mode", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph commits={[COMMIT]} selection={null} onSelectCommit={onSelect} labels={LABELS} />,
    );

    const row = screen.getByText("feat: x").closest("div[class*='absolute']");
    fireEvent.click(row!, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(COMMIT, { shiftKey: true });
  });

  it("blocks the browser's native text-selection drag on a shift-mousedown, but not a plain one", () => {
    render(
      <GitGraph commits={[COMMIT]} selection={null} onSelectCommit={vi.fn()} labels={LABELS} />,
    );
    const row = screen.getByText("feat: x").closest("div[class*='absolute']")!;

    const shiftMouseDown = createEvent.mouseDown(row, { shiftKey: true });
    fireEvent(row, shiftMouseDown);
    expect(shiftMouseDown.defaultPrevented).toBe(true);

    const plainMouseDown = createEvent.mouseDown(row, { shiftKey: false });
    fireEvent(row, plainMouseDown);
    expect(plainMouseDown.defaultPrevented).toBe(false);
  });
});

describe("GitGraph keyboard navigation", () => {
  const commits = [
    commit("c", ["b"], "msg c"),
    commit("b", ["a"], "msg b"),
    commit("a", [], "msg a"),
  ];

  function renderGraph(selected: CommitNode, onSelect = vi.fn()) {
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: selected }}
        onSelectCommit={onSelect}
        labels={LABELS}
      />,
    );
    return onSelect;
  }

  it("ArrowDown moves to the adjacent row below", () => {
    const onSelect = renderGraph(commits[0]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(commits[1], { shiftKey: false });
  });

  it("ArrowUp moves to the adjacent row above", () => {
    const onSelect = renderGraph(commits[1]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith(commits[0], { shiftKey: false });
  });

  it("clamps at the bottom without wrapping", () => {
    const onSelect = renderGraph(commits[2]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clamps at the top without wrapping", () => {
    const onSelect = renderGraph(commits[0]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Shift+ArrowDown follows the first-parent chain", () => {
    const onSelect = renderGraph(commits[0]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown", shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(commits[1], { shiftKey: false });
  });

  it("Shift+ArrowUp no-ops on the newest commit of a lane", () => {
    const onSelect = renderGraph(commits[0]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp", shiftKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Shift+ArrowUp follows the lane continuation", () => {
    const onSelect = renderGraph(commits[1]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp", shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(commits[0], { shiftKey: false });
  });

  it("Shift+ArrowDown no-ops at a root commit", () => {
    const onSelect = renderGraph(commits[2]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown", shiftKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Shift+ArrowDown requests pagination when the parent is not loaded", () => {
    usePendingGraphSelectionStore.setState({ hash: null });
    const rootless = [commit("only", ["missing-parent"], "msg only")];
    render(
      <GitGraph
        commits={rootless}
        selection={{ mode: "single", commit: rootless[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    fireEvent.keyDown(container("msg only"), { key: "ArrowDown", shiftKey: true });
    expect(usePendingGraphSelectionStore.getState().hash).toBe("missing-parent");
  });
});

describe("GitGraph compare-mode exit at boundaries", () => {
  const commits = [
    commit("c", ["b"], "msg c"),
    commit("b", ["a"], "msg b"),
    commit("a", [], "msg a"),
  ];

  it("plain ArrowDown at the bottom still collapses out of compare mode", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "compare", from: commits[0], to: commits[2] }}
        onSelectCommit={onSelect}
        labels={LABELS}
      />,
    );
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(commits[2], { shiftKey: false });
  });

  it("plain ArrowUp at the top still collapses out of compare mode", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "compare", from: commits[2], to: commits[0] }}
        onSelectCommit={onSelect}
        labels={LABELS}
      />,
    );
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith(commits[0], { shiftKey: false });
  });

  it("Shift+ArrowDown at a root commit still collapses out of compare mode", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "compare", from: commits[0], to: commits[2] }}
        onSelectCommit={onSelect}
        labels={LABELS}
      />,
    );
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown", shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(commits[2], { shiftKey: false });
  });

  it("Shift+ArrowUp on the newest commit of a lane still collapses out of compare mode", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "compare", from: commits[2], to: commits[0] }}
        onSelectCommit={onSelect}
        labels={LABELS}
      />,
    );
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp", shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(commits[0], { shiftKey: false });
  });
});

describe("GitGraph auto-scroll", () => {
  const commits = [
    commit("c", ["b"], "msg c"),
    commit("b", ["a"], "msg b"),
    commit("a", [], "msg a"),
  ];

  it("scrolls down so the newly active row's bottom edge is visible", () => {
    const { rerender } = render(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    const scrollContainer = container("msg c");
    Object.defineProperty(scrollContainer, "clientHeight", { value: 40, configurable: true });
    scrollContainer.scrollTop = 0;

    rerender(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[2] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );

    // commits[2] ("a") is row index 2: y = 20 + 2*36 = 92, half-height 18 =>
    // bottom edge at 110, below the 40px-tall visible window starting at 0.
    expect(scrollContainer.scrollTop).toBe(70);
  });

  it("does not scroll when the newly active row is already fully visible", () => {
    const { rerender } = render(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    const scrollContainer = container("msg c");
    Object.defineProperty(scrollContainer, "clientHeight", { value: 200, configurable: true });
    scrollContainer.scrollTop = 0;

    rerender(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[1] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );

    expect(scrollContainer.scrollTop).toBe(0);
  });

  it("does not re-scroll when layouts change but the active commit stays the same (e.g. pagination)", () => {
    const { rerender } = render(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    const scrollContainer = document.querySelector("div.flex-1.overflow-auto") as HTMLElement;
    Object.defineProperty(scrollContainer, "clientHeight", { value: 200, configurable: true });
    // The user manually scrolled away from the active row to browse history.
    scrollContainer.scrollTop = 500;

    // More history pages in: `commits` gets a new array identity (and thus a
    // new `layouts` object from useMemo), but the selection is unchanged.
    const morePages = [...commits, commit("z", [], "msg z")];
    rerender(
      <GitGraph
        commits={morePages}
        selection={{ mode: "single", commit: commits[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );

    expect(scrollContainer.scrollTop).toBe(500);
  });

  it("still scrolls once the active commit's layout becomes available after a hash change with no layout yet", () => {
    const missing = commit("x", [], "msg x");
    const { rerender } = render(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    const scrollContainer = document.querySelector("div.flex-1.overflow-auto") as HTMLElement;
    Object.defineProperty(scrollContainer, "clientHeight", { value: 40, configurable: true });
    scrollContainer.scrollTop = 0;

    // Selection points at a commit whose layout doesn't exist yet (e.g. its
    // page is still loading) — the effect must bail without "consuming"
    // this hash change.
    rerender(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: missing }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    expect(scrollContainer.scrollTop).toBe(0);

    // The commit's page finishes loading: it's now in commits/layouts, and
    // the selection is unchanged. The scroll must still happen here, not be
    // silently skipped because the earlier render already "used up" the
    // hash change.
    const loaded = [...commits, missing];
    rerender(
      <GitGraph
        commits={loaded}
        selection={{ mode: "single", commit: missing }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );

    // "x" is row index 3: y = 20 + 3*36 = 128, bottom edge 146, beyond the
    // 40px-tall window starting at 0 => scrollTop becomes 146 - 40 = 106.
    expect(scrollContainer.scrollTop).toBe(106);
  });
});

describe("GitGraph compare-mode highlighting", () => {
  it("marks both endpoints as selected", () => {
    const commits = [commit("c", ["b"], "msg c"), commit("b", ["a"], "msg b")];
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "compare", from: commits[1], to: commits[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    const rowC = screen.getByText("msg c").closest("div[class*='absolute']");
    const rowB = screen.getByText("msg b").closest("div[class*='absolute']");
    expect(rowC!.className).toContain("border-border-strong");
    expect(rowB!.className).toContain("border-border-strong");
  });
});

describe("GitGraph working-tree row", () => {
  const commits = [commit("c", ["b"], "msg c"), commit("b", [], "msg b")];

  const ROW_LABELS = {
    emptyTitle: "No commits",
    emptyHint: "",
    loadMore: "Load more",
    refHint: "{{name}}",
    uncommittedTitle: "Uncommitted changes",
    uncommittedClean: "No uncommitted changes",
    uncommittedSummary: (staged: number, unstaged: number) =>
      `${staged} staged · ${unstaged} unstaged`,
  } as never;

  function renderRow(
    props: Partial<Parameters<typeof GitGraph>[0]> = {},
  ): Record<string, ReturnType<typeof vi.fn>> {
    const onSelectCommit = vi.fn();
    const onSelectWorkspace = vi.fn();
    const onWorkspaceContextMenu = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={null}
        onSelectCommit={onSelectCommit}
        onSelectWorkspace={onSelectWorkspace}
        onWorkspaceContextMenu={onWorkspaceContextMenu}
        uncommitted={{ staged: 3, unstaged: 4 }}
        labels={ROW_LABELS}
        {...props}
      />,
    );
    return { onSelectCommit, onSelectWorkspace, onWorkspaceContextMenu };
  }

  it("is left out entirely when the setting is off", () => {
    renderRow({ uncommitted: null });
    expect(screen.queryByText("Uncommitted changes")).not.toBeInTheDocument();
    expect(screen.queryByText("No uncommitted changes")).not.toBeInTheDocument();
  });

  it("puts the lanes back exactly when the setting is off", () => {
    // HEAD taking the leftmost lane exists to serve the dashed segment, so it
    // has to go when the row does — switching a feature off cannot leave every
    // branch shifted sideways.
    const head = commit("head", [], "msg head");
    head.refs = [{ name: "master", kind: "head" }];
    const withHead = [commit("newer", ["head"], "msg newer"), head];
    // Node buttons carry their left offset inline; the working tree's is the
    // only one with an accessible name, so the commits are the rest.
    const commitNodeLefts = (): string[] =>
      Array.from(document.querySelectorAll<HTMLElement>("button[class*='rounded-full']"))
        .filter((n) => n.getAttribute("aria-label") !== "Uncommitted changes")
        .map((n) => n.style.left);
    const lane0 = `${laneX(0, DEFAULT_GEOMETRY) - NODE_OFFSET}px`;

    const { unmount } = render(
      <GitGraph
        commits={withHead}
        selection={null}
        onSelectCommit={vi.fn()}
        uncommitted={null}
        labels={ROW_LABELS}
      />,
    );
    expect(commitNodeLefts()[0]).toBe(lane0);
    unmount();

    render(
      <GitGraph
        commits={withHead}
        selection={null}
        onSelectCommit={vi.fn()}
        onSelectWorkspace={vi.fn()}
        uncommitted={{ staged: 0, unstaged: 1 }}
        labels={ROW_LABELS}
      />,
    );
    // Row on: the newest commit gives the leftmost track up to HEAD.
    expect(commitNodeLefts()[0]).not.toBe(lane0);
    expect(screen.getByLabelText("Uncommitted changes").style.left).toBe(lane0);
  });

  it("shows the counts beside the message, not in the author column", () => {
    renderRow();
    const row = screen.getByText("Uncommitted changes").closest("div[class*='absolute']")!;
    expect(row).toHaveTextContent("3 staged · 4 unstaged");
    // The author/time column is what tells a reader this is not a commit, so
    // it has to stay empty.
    expect(row.querySelectorAll("svg")).toHaveLength(0);
  });

  it("stays put but goes quiet when the tree is clean", () => {
    // Not removed: dropping the row the moment the tree went clean would jump
    // the whole graph up a row on every commit.
    renderRow({ uncommitted: { staged: 0, unstaged: 0 } });
    expect(screen.getByText("No uncommitted changes")).toBeInTheDocument();
    expect(screen.queryByText(/staged ·/)).not.toBeInTheDocument();
  });

  it("selects the working tree from the row and from its node", () => {
    const { onSelectWorkspace } = renderRow();
    fireEvent.click(screen.getByText("Uncommitted changes").closest("div[class*='absolute']")!);
    expect(onSelectWorkspace).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Uncommitted changes"));
    expect(onSelectWorkspace).toHaveBeenCalledTimes(2);
  });

  it("opens its own context menu rather than the commit one", () => {
    const { onWorkspaceContextMenu, onSelectCommit } = renderRow();
    const row = screen.getByText("Uncommitted changes").closest("div[class*='absolute']")!;
    fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
    expect(onWorkspaceContextMenu).toHaveBeenCalledWith(40, 60);
    expect(onSelectCommit).not.toHaveBeenCalled();
  });
});

describe("GitGraph working-tree row keyboard navigation", () => {
  const commits = [commit("c", ["b"], "msg c"), commit("b", [], "msg b")];

  const ROW_LABELS = {
    emptyTitle: "No commits",
    emptyHint: "",
    loadMore: "Load more",
    refHint: "{{name}}",
    uncommittedTitle: "Uncommitted changes",
    uncommittedClean: "No uncommitted changes",
    uncommittedSummary: () => "",
  } as never;

  it("ArrowUp from the newest commit steps onto the working-tree row", () => {
    const onSelectWorkspace = vi.fn();
    const onSelectCommit = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[0] }}
        onSelectCommit={onSelectCommit}
        onSelectWorkspace={onSelectWorkspace}
        uncommitted={{ staged: 1, unstaged: 0 }}
        labels={ROW_LABELS}
      />,
    );
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp" });
    expect(onSelectWorkspace).toHaveBeenCalledTimes(1);
    expect(onSelectCommit).not.toHaveBeenCalled();
  });

  it("ArrowUp still clamps at the top when the row is switched off", () => {
    const onSelectWorkspace = vi.fn();
    const onSelectCommit = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[0] }}
        onSelectCommit={onSelectCommit}
        onSelectWorkspace={onSelectWorkspace}
        uncommitted={null}
        labels={ROW_LABELS}
      />,
    );
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp" });
    expect(onSelectWorkspace).not.toHaveBeenCalled();
    expect(onSelectCommit).not.toHaveBeenCalled();
  });

  it("ArrowDown from the working-tree row lands on the newest commit", () => {
    const onSelectCommit = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "workspace" }}
        onSelectCommit={onSelectCommit}
        onSelectWorkspace={vi.fn()}
        uncommitted={{ staged: 1, unstaged: 0 }}
        labels={ROW_LABELS}
      />,
    );
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown" });
    expect(onSelectCommit).toHaveBeenCalledWith(commits[0], { shiftKey: false });
  });

  it("ignores ArrowUp and Shift+ArrowUp on the working-tree row", () => {
    // Nothing sits above it, and Shift+Up has no line to follow from there.
    const onSelectCommit = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "workspace" }}
        onSelectCommit={onSelectCommit}
        onSelectWorkspace={vi.fn()}
        uncommitted={{ staged: 1, unstaged: 0 }}
        labels={ROW_LABELS}
      />,
    );
    const scroller = container("msg c");
    fireEvent.keyDown(scroller, { key: "ArrowUp" });
    fireEvent.keyDown(scroller, { key: "ArrowUp", shiftKey: true });
    expect(onSelectCommit).not.toHaveBeenCalled();
  });

  describe("following the dashed segment", () => {
    // HEAD is the second row: another branch has a newer commit, so the row
    // below the working tree and the commit its line runs to are different.
    const head = commit("head", [], "msg head");
    head.refs = [{ name: "master", kind: "head" }];
    const withHead = [commit("newer", ["head"], "msg newer"), head];

    it("Shift+ArrowDown goes to HEAD, not to the row underneath", () => {
      const onSelectCommit = vi.fn();
      render(
        <GitGraph
          commits={withHead}
          selection={{ mode: "workspace" }}
          onSelectCommit={onSelectCommit}
          onSelectWorkspace={vi.fn()}
          uncommitted={{ staged: 1, unstaged: 0 }}
          labels={ROW_LABELS}
        />,
      );
      fireEvent.keyDown(container("msg newer"), { key: "ArrowDown", shiftKey: true });
      expect(onSelectCommit).toHaveBeenCalledWith(head, { shiftKey: false });
    });

    it("plain ArrowDown still moves by row", () => {
      const onSelectCommit = vi.fn();
      render(
        <GitGraph
          commits={withHead}
          selection={{ mode: "workspace" }}
          onSelectCommit={onSelectCommit}
          onSelectWorkspace={vi.fn()}
          uncommitted={{ staged: 1, unstaged: 0 }}
          labels={ROW_LABELS}
        />,
      );
      fireEvent.keyDown(container("msg newer"), { key: "ArrowDown" });
      expect(onSelectCommit).toHaveBeenCalledWith(withHead[0], { shiftKey: false });
    });

    it("Shift+ArrowUp from HEAD follows the segment back to the row", () => {
      const onSelectWorkspace = vi.fn();
      render(
        <GitGraph
          commits={withHead}
          selection={{ mode: "single", commit: head }}
          onSelectCommit={vi.fn()}
          onSelectWorkspace={onSelectWorkspace}
          uncommitted={{ staged: 1, unstaged: 0 }}
          labels={ROW_LABELS}
        />,
      );
      fireEvent.keyDown(container("msg newer"), { key: "ArrowUp", shiftKey: true });
      expect(onSelectWorkspace).toHaveBeenCalledTimes(1);
    });

    it("does not follow it from a commit that is not HEAD", () => {
      const onSelectWorkspace = vi.fn();
      render(
        <GitGraph
          commits={withHead}
          selection={{ mode: "single", commit: withHead[0] }}
          onSelectCommit={vi.fn()}
          onSelectWorkspace={onSelectWorkspace}
          uncommitted={{ staged: 1, unstaged: 0 }}
          labels={ROW_LABELS}
        />,
      );
      fireEvent.keyDown(container("msg newer"), { key: "ArrowUp", shiftKey: true });
      expect(onSelectWorkspace).not.toHaveBeenCalled();
    });

    it("does not follow it when the row is switched off", () => {
      const onSelectWorkspace = vi.fn();
      render(
        <GitGraph
          commits={withHead}
          selection={{ mode: "single", commit: head }}
          onSelectCommit={vi.fn()}
          onSelectWorkspace={onSelectWorkspace}
          uncommitted={null}
          labels={ROW_LABELS}
        />,
      );
      fireEvent.keyDown(container("msg newer"), { key: "ArrowUp", shiftKey: true });
      expect(onSelectWorkspace).not.toHaveBeenCalled();
    });
  });
});

describe("GitGraph wide histories", () => {
  /**
   * A merge of `n` roots: the merge keeps lane 0 and every extra parent claims
   * one of its own, so the graph is exactly `n` lanes wide.
   */
  function fan(n: number): CommitNode[] {
    const roots = Array.from({ length: n }, (_, i) => `r${i}`);
    return [commit("m", roots, "merge"), ...roots.map((r) => commit(r, [], r))];
  }

  const nodeRights = (): number[] =>
    Array.from(document.querySelectorAll<HTMLElement>("button[class*='rounded-full']"))
      .filter((n) => n.getAttribute("aria-label") !== "Uncommitted changes")
      .map((n) => parseFloat(n.style.left) + NODE_OFFSET * 2);

  const rowIndent = (text: string): number => {
    const row = screen.getByText(text).closest("div[class*='absolute']") as HTMLElement;
    return parseFloat(row.style.paddingLeft);
  };

  it("keeps the rows clear of the widest node", () => {
    // The regression this guards: the tracks were sized in one place and the
    // rows indented in another, so the moment the lanes could outgrow six
    // columns the nodes were drawn on top of the commit hashes.
    for (const lanes of [2, 6, 7, 9, 12]) {
      const { unmount } = render(
        <GitGraph commits={fan(lanes)} selection={null} onSelectCommit={vi.fn()} labels={LABELS} />,
      );
      expect(Math.max(...nodeRights())).toBeLessThanOrEqual(rowIndent("merge"));
      unmount();
    }
  });

  it("leaves six lanes indented exactly where they have always been", () => {
    render(<GitGraph commits={fan(6)} selection={null} onSelectCommit={vi.fn()} labels={LABELS} />);
    expect(rowIndent("merge")).toBe(112);
  });

  const nodes = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>("button[class*='rounded-full']")).filter(
      (n) => n.getAttribute("aria-label") !== "Uncommitted changes",
    );

  /**
   * The same fan, with the roots listed newest-first so the widest lanes land
   * in the rows the virtualized list actually renders. `fan` puts lane 39 on
   * row 40, which never reaches the DOM.
   */
  function wideFirst(n: number): CommitNode[] {
    const roots = Array.from({ length: n }, (_, i) => `r${i}`);
    return [
      commit("m", roots, "merge"),
      ...[...roots].reverse().map((r) => commit(r, [], r)),
    ];
  }

  it("leaves no node behind once it has faded out", () => {
    // A node drawn at zero opacity is still in the tab order, still clickable
    // and still pops a tooltip — a control nobody can see. Past the fade it is
    // left out instead; the row is a click target in its own right.
    const drawn: number[] = [];
    for (const lanes of [20, 21, 40]) {
      const { unmount } = render(
        <GitGraph
          commits={wideFirst(lanes)}
          selection={null}
          onSelectCommit={vi.fn()}
          labels={LABELS}
        />,
      );
      expect(nodes().map((n) => n.style.opacity)).not.toContain("0");
      drawn.push(nodes().length);
      unmount();
    }
    // Proof the case above is exercised rather than vacuously true: at forty
    // lanes the top rows are all past the ceiling, so far fewer nodes survive
    // than at twenty, where every one of them still has a column.
    expect(drawn[2]).toBeLessThan(drawn[0]);
  });
});

describe("GitGraph open ends", () => {
  // The second row's parent is not in the page, so the only thing joining
  // anything is the edge between the two rows that are here.
  const partial = [commit("c", ["b"], "msg c"), commit("b", ["not-loaded"], "msg b")];
  // Only the tracks layer — the row icons are svgs with paths of their own.
  const paths = () =>
    document.querySelectorAll('svg[class*="pointer-events-none"] path').length;

  it("carries the line past the last row while there is more to load", () => {
    render(
      <GitGraph
        commits={partial}
        selection={null}
        onSelectCommit={vi.fn()}
        hasMore
        labels={LABELS}
      />,
    );
    // The edge between the two rows, plus the line leaving the page.
    expect(paths()).toBe(2);
  });

  it("draws nothing once the walk is exhausted", () => {
    // A parent that still will not resolve with nothing left to load is a
    // shallow clone's boundary: the history really does stop there, and a
    // line promising more below it would be a lie.
    render(
      <GitGraph
        commits={partial}
        selection={null}
        onSelectCommit={vi.fn()}
        hasMore={false}
        labels={LABELS}
      />,
    );
    expect(paths()).toBe(1);
  });

  const WORKSPACE_LABELS = {
    emptyTitle: "No commits",
    emptyHint: "",
    loadMore: "Load more",
    refHint: "{{name}}",
    uncommittedTitle: "Uncommitted changes",
    uncommittedClean: "No uncommitted changes",
    uncommittedSummary: () => "",
  } as never;

  const trackPaths = (): string[] =>
    Array.from(
      document.querySelectorAll<SVGPathElement>('svg[class*="pointer-events-none"] path'),
    ).map((p) => p.getAttribute("d") ?? "");

  const commitNodes = (): HTMLElement[] =>
    Array.from(
      document.querySelectorAll<HTMLElement>("button[class*='rounded-full']"),
    ).filter((n) => n.getAttribute("aria-label") !== "Uncommitted changes");

  /** How far down the lowest track reaches. */
  const foot = (): number =>
    Math.max(...trackPaths().map((d) => parseFloat(d.trim().split(" ").pop() as string)));

  it("leaves the node it belongs to, even while waiting on another lane", () => {
    // A merge's second parent waits on a lane of its own. Starting the line on
    // that lane leaves it hanging a lane clear of the node, so it reads as a
    // line beginning in mid-air rather than as that merge's missing history.
    render(
      <GitGraph
        commits={[commit("m", ["a", "not-loaded"], "merge"), commit("a", [], "root")]}
        selection={null}
        onSelectCommit={vi.fn()}
        hasMore
        labels={LABELS}
      />,
    );

    const centres = new Set(
      commitNodes().map((n) => parseFloat(n.style.left) + NODE_OFFSET),
    );
    const starts = trackPaths().map((d) => parseFloat(d.slice(2).split(" ")[0]));
    // The edge between the merge and its loaded parent, and the line leaving.
    expect(starts).toHaveLength(2);
    for (const x of starts) {
      expect(centres.has(x)).toBe(true);
    }
  });

  it("stops half a row past the last node, and follows the working-tree row down", () => {
    const { unmount } = render(
      <GitGraph
        commits={partial}
        selection={null}
        onSelectCommit={vi.fn()}
        hasMore
        labels={LABELS}
      />,
    );
    // Every open end ends on the same line, below the last row rather than
    // level with a dot that happens to be on another lane.
    const lastNodeY = Math.max(
      ...commitNodes().map((n) => parseFloat(n.style.top) + NODE_OFFSET),
    );
    const bare = foot();
    expect(bare).toBe(lastNodeY + DEFAULT_GEOMETRY.rowHeight / 2);
    unmount();

    render(
      <GitGraph
        commits={partial}
        selection={null}
        onSelectCommit={vi.fn()}
        hasMore
        uncommitted={{ staged: 0, unstaged: 0 }}
        labels={WORKSPACE_LABELS}
      />,
    );
    // The working-tree row pushes every commit down one, and the foot with it.
    expect(foot()).toBe(bare + DEFAULT_GEOMETRY.rowHeight);
  });
});
