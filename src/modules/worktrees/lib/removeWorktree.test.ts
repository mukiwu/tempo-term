import { describe, expect, it } from "vitest";
import { leaf, splitLeaf, type LayoutNode } from "@/modules/terminal/lib/terminalLayout";
import type { Tab } from "@/stores/tabsStore";
import { panesInWorktree, removalBlocker } from "./removeWorktree";

const WT = "/code/repo-worktrees/feat-a";

function tab(id: string, paneTree: LayoutNode, paneOrder: string[], cwd?: string): Tab {
  return { id, spaceId: "s1", title: id, kind: "terminal", paneTree, activeLeafId: paneOrder[0], paneOrder, cwd };
}

describe("removalBlocker", () => {
  it("lets a clean worktree go", () => {
    expect(removalBlocker({ dirty: 0, isMain: false, locked: false })).toBeNull();
  });

  it("never lets the main worktree go — it is the repo", () => {
    expect(removalBlocker({ dirty: 0, isMain: true, locked: false })).toBe("main");
  });

  it("stops at uncommitted work, which is the whole point of the block", () => {
    expect(removalBlocker({ dirty: 3, isMain: false, locked: false })).toBe("dirty");
  });

  it("stops at a locked worktree, and says so rather than letting git refuse", () => {
    expect(removalBlocker({ dirty: 0, isMain: false, locked: true })).toBe("locked");
  });

  it("names the worse problem first when there is more than one", () => {
    // Being the repo itself is not something a confirmation can get past.
    expect(removalBlocker({ dirty: 5, isMain: true, locked: true })).toBe("main");
    expect(removalBlocker({ dirty: 5, isMain: false, locked: true })).toBe("locked");
  });

  it("treats an unknown dirty count as dirty, not as clean", () => {
    // The count not having landed is not evidence there is nothing to lose.
    expect(removalBlocker({ dirty: null, isMain: false, locked: false })).toBe("dirty");
  });

  it("lets a worktree whose directory is already gone be dropped", () => {
    // Nothing to lose: the files are not there. This is what prune is for, and
    // refusing would leave the entry unremovable from the app.
    expect(removalBlocker({ dirty: null, isMain: false, locked: false, prunable: true })).toBeNull();
  });
});

describe("panesInWorktree", () => {
  it("finds every pane in the worktree, not just the first", () => {
    const split = splitLeaf(
      leaf("p1", { kind: "terminal", cwd: WT }),
      "p1",
      "row",
      "p2",
      { kind: "terminal", cwd: `${WT}/src` },
    );
    const tabs = [tab("t1", split, ["p1", "p2"])];

    expect(panesInWorktree(tabs, WT, false)).toEqual([
      { tabId: "t1", leafId: "p1" },
      { tabId: "t1", leafId: "p2" },
    ]);
  });

  it("leaves a sibling worktree's panes alone", () => {
    const tabs = [tab("t1", leaf("p1", { kind: "terminal", cwd: "/code/repo-worktrees/feat-ab" }), ["p1"])];
    expect(panesInWorktree(tabs, WT, false)).toEqual([]);
  });

  it("leaves an SSH pane alone — its shell is not holding this directory", () => {
    const tabs = [tab("t1", leaf("p1", { kind: "terminal", ssh: { connectionId: "c1" } }), ["p1"], WT)];
    expect(panesInWorktree(tabs, WT, false)).toEqual([]);
  });

  it("reaches across tabs", () => {
    const tabs = [
      tab("t1", leaf("p1", { kind: "terminal", cwd: "/elsewhere" }), ["p1"]),
      tab("t2", leaf("p2", { kind: "terminal", cwd: WT }), ["p2"]),
    ];
    expect(panesInWorktree(tabs, WT, false)).toEqual([{ tabId: "t2", leafId: "p2" }]);
  });
});
