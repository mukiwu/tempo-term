import { describe, expect, it } from "vitest";
import { leaf, splitLeaf, type LayoutNode } from "@/modules/terminal/lib/terminalLayout";
import type { Tab } from "@/stores/tabsStore";
import { findWorktreePane } from "./openWorktree";

function tab(id: string, paneTree: LayoutNode, cwd?: string): Tab {
  return {
    id,
    spaceId: "s1",
    title: id,
    kind: "terminal",
    paneTree,
    activeLeafId: "p1",
    paneOrder: ["p1"],
    cwd,
  };
}

function terminalLeaf(paneId: string, cwd?: string): LayoutNode {
  return leaf(paneId, cwd ? { kind: "terminal", cwd } : { kind: "terminal" });
}

const WT = "/code/repo-worktrees/feat-a";

describe("findWorktreePane", () => {
  it("finds the pane sitting in the worktree", () => {
    const tabs = [tab("t1", terminalLeaf("p1", WT))];
    expect(findWorktreePane(tabs, WT, false)).toEqual({ tabId: "t1", leafId: "p1" });
  });

  it("counts a pane that has cd'd deeper in — it is still that worktree", () => {
    const tabs = [tab("t1", terminalLeaf("p1", `${WT}/src/lib`))];
    expect(findWorktreePane(tabs, WT, false)).toEqual({ tabId: "t1", leafId: "p1" });
  });

  it("does not mistake a sibling worktree for this one", () => {
    // The whole point of isUnder: these two share a prefix up to the separator.
    const tabs = [tab("t1", terminalLeaf("p1", "/code/repo-worktrees/feat-ab"))];
    expect(findWorktreePane(tabs, WT, false)).toBeNull();
  });

  it("does not mistake the repo it came from for the worktree", () => {
    const tabs = [tab("t1", terminalLeaf("p1", "/code/repo"))];
    expect(findWorktreePane(tabs, WT, false)).toBeNull();
  });

  it("falls back to the tab's starting dir for a pane that has not reported yet", () => {
    const tabs = [tab("t1", terminalLeaf("p1"), WT)];
    expect(findWorktreePane(tabs, WT, false)).toEqual({ tabId: "t1", leafId: "p1" });
  });

  it("ignores panes that are not terminals", () => {
    const tabs = [tab("t1", leaf("p1", { kind: "editor", path: `${WT}/README.md` }))];
    expect(findWorktreePane(tabs, WT, false)).toBeNull();
  });

  it("looks past the first tab and into splits", () => {
    const split = splitLeaf(terminalLeaf("p1", "/elsewhere"), "p1", "row", "p2", {
      kind: "terminal",
      cwd: WT,
    });
    const tabs = [tab("t0", terminalLeaf("p9", "/other")), tab("t1", split)];
    expect(findWorktreePane(tabs, WT, false)).toEqual({ tabId: "t1", leafId: "p2" });
  });

  it("returns nothing when the worktree is not open anywhere", () => {
    const tabs = [tab("t1", terminalLeaf("p1", "/elsewhere"))];
    expect(findWorktreePane(tabs, WT, false)).toBeNull();
  });

  it("never offers an SSH shell as the way into a local worktree", () => {
    // `ssh` is a flag on ordinary terminal content, and an SSH pane split into a
    // tab that sits in a worktree inherits that tab's cwd. Focusing it would put
    // the user on a remote host and call it their worktree.
    const tabs = [
      tab("t1", leaf("p1", { kind: "terminal", ssh: { connectionId: "c1" } }), WT),
      tab("t2", leaf("p2", { kind: "terminal", cwd: WT, ssh: { connectionId: "c2" } })),
    ];
    expect(findWorktreePane(tabs, WT, false)).toBeNull();
  });

  it("matches case-insensitively on Windows, where the pty's spelling need not match git's", () => {
    const tabs = [tab("t1", terminalLeaf("p1", "C:/Code/Repo-Worktrees/Feat-A"))];
    expect(findWorktreePane(tabs, "c:\\code\\repo-worktrees\\feat-a", true)).toEqual({
      tabId: "t1",
      leafId: "p1",
    });
  });
});
