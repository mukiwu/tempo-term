import { beforeEach, describe, expect, it } from "vitest";
import {
  activeEditorPath,
  localPreviewFilePaths,
  openEditorPaths,
  tabHasDirtyEditor,
  useTabsStore,
  migratePersistedTabs,
  type Tab,
} from "./tabsStore";
import {
  computeLayout,
  findPaneContent,
  leaf,
  leafIds,
  paneOf,
  splitLeaf,
  type LayoutNode,
} from "@/modules/terminal/lib/terminalLayout";

function reset() {
  useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
}

function activeTab(): Tab {
  const s = useTabsStore.getState();
  const tab = s.tabs.find((t) => t.id === s.activeId);
  if (!tab) {
    throw new Error("no active tab");
  }
  return tab;
}

function firstLeafContent(tab: Tab) {
  const node = tab.paneTree as Extract<LayoutNode, { kind: "leaf" }>;
  return paneOf(node);
}

describe("openEditorPaths", () => {
  beforeEach(reset);

  it("collects editor paths across tabs and split panes", () => {
    const store = useTabsStore.getState();
    const t1 = store.openEditorTab("/a.ts");
    store.openEditorTab("/b.ts");
    const tab1 = useTabsStore.getState().tabs.find((t) => t.id === t1)!;
    useTabsStore
      .getState()
      .splitPaneWith(t1, tab1.activeLeafId, { kind: "editor", path: "/c.ts" }, "row");
    expect(openEditorPaths(useTabsStore.getState().tabs).sort()).toEqual([
      "/a.ts",
      "/b.ts",
      "/c.ts",
    ]);
  });

  it("ignores non-editor panes", () => {
    useTabsStore.getState().newTerminalTab();
    expect(openEditorPaths(useTabsStore.getState().tabs)).toEqual([]);
  });
});

describe("tabsStore", () => {
  beforeEach(reset);

  it("opens a terminal tab with a single pane and activates it", () => {
    const id = useTabsStore.getState().newTerminalTab();
    expect(useTabsStore.getState().activeId).toBe(id);
    const tab = activeTab();
    expect(tab.kind).toBe("terminal");
    expect(leafIds(tab.paneTree)).toHaveLength(1);
  });

  it("renames a terminal tab to follow its cwd, unless the user renamed it", () => {
    const id = useTabsStore.getState().newTerminalTab("/a/proj");
    expect(activeTab().title).toBe("proj");

    useTabsStore.getState().syncTabTitleToCwd(id, "/a/other");
    expect(activeTab().title).toBe("other");

    useTabsStore.getState().setTabTitle(id, "My Tab");
    useTabsStore.getState().syncTabTitleToCwd(id, "/a/changed");
    expect(activeTab().title).toBe("My Tab");
  });

  it("opens an editor tab named from the file, deduping by path", () => {
    const first = useTabsStore.getState().openEditorTab("/a/b.ts");
    useTabsStore.getState().newTerminalTab();
    const again = useTabsStore.getState().openEditorTab("/a/b.ts");
    expect(again).toBe(first);
    const tabs = useTabsStore.getState().tabs;
    expect(tabs.filter((t) => t.kind === "editor")).toHaveLength(1);
    expect(tabs.find((t) => t.id === first)?.title).toBe("b.ts");
  });

  it("splits the active terminal tab's pane", () => {
    useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().splitActivePane("row");
    expect(leafIds(activeTab().paneTree)).toHaveLength(2);
  });

  it("splits into a launcher pane so the user can choose its content", () => {
    useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().splitActivePane("row");
    const panes = computeLayout(activeTab().paneTree);
    const added = panes.find((p) => p.id === activeTab().activeLeafId);
    expect(added?.content).toEqual({ kind: "launcher" });
  });

  it("splits the active editor tab's pane", () => {
    useTabsStore.getState().openEditorTab("/a/b.ts");
    useTabsStore.getState().splitActivePane("row");
    expect(leafIds(activeTab().paneTree)).toHaveLength(2);
  });

  it("cycles the active pane through the leaves and wraps around", () => {
    useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().splitActivePane("row");
    useTabsStore.getState().splitActivePane("col");
    const ids = leafIds(activeTab().paneTree);
    expect(ids).toHaveLength(3);

    // Start from the first leaf, then step through every pane and back to start.
    useTabsStore.getState().setActiveLeaf(activeTab().id, ids[0]);
    useTabsStore.getState().focusNextPane();
    expect(activeTab().activeLeafId).toBe(ids[1]);
    useTabsStore.getState().focusNextPane();
    expect(activeTab().activeLeafId).toBe(ids[2]);
    useTabsStore.getState().focusNextPane();
    expect(activeTab().activeLeafId).toBe(ids[0]);
  });

  it("leaves the active pane unchanged when the tab has a single pane", () => {
    useTabsStore.getState().newTerminalTab();
    const only = activeTab().activeLeafId;
    useTabsStore.getState().focusNextPane();
    expect(activeTab().activeLeafId).toBe(only);
  });

  it("splits a pane with the given content and activates it", () => {
    useTabsStore.getState().newTerminalTab();
    const tab = activeTab();
    useTabsStore
      .getState()
      .splitPaneWith(tab.id, tab.activeLeafId, { kind: "editor", path: "/x/App.tsx" }, "row");
    const updated = activeTab();
    const panes = computeLayout(updated.paneTree);
    expect(panes).toHaveLength(2);
    const editor = panes.find((p) => p.content.kind === "editor");
    expect(editor?.content).toEqual({ kind: "editor", path: "/x/App.tsx" });
    expect(updated.activeLeafId).toBe(editor?.id);
  });

  it("can split with a note or preview pane", () => {
    useTabsStore.getState().newTerminalTab();
    const tab = activeTab();
    useTabsStore
      .getState()
      .splitPaneWith(tab.id, tab.activeLeafId, { kind: "note", noteId: "n1" }, "col");
    const panes = computeLayout(activeTab().paneTree);
    expect(panes.some((p) => p.content.kind === "note")).toBe(true);
  });

  it("opens editor/note/preview/git-graph as single-leaf pane tabs", () => {
    const e = useTabsStore.getState().openEditorTab("/a/b.ts");
    expect(firstLeafContent(activeTab())).toEqual({ kind: "editor", path: "/a/b.ts" });
    expect(
      leafIds(useTabsStore.getState().tabs.find((t) => t.id === e)!.paneTree),
    ).toHaveLength(1);

    const n = useTabsStore.getState().openNoteTab("note-1", "My Note");
    expect(firstLeafContent(activeTab())).toEqual({ kind: "note", noteId: "note-1" });
    expect(useTabsStore.getState().tabs.find((t) => t.id === n)!.kind).toBe("note");

    useTabsStore.getState().openPreviewTab("http://localhost:5173");
    expect(firstLeafContent(activeTab())).toEqual({
      kind: "preview",
      url: "http://localhost:5173",
    });

    useTabsStore.getState().openGitGraphTab();
    expect(firstLeafContent(activeTab())).toEqual({ kind: "git-graph" });
  });

  it("splits, resizes and closes panes on a non-terminal (editor) tab", () => {
    const id = useTabsStore.getState().openEditorTab("/a/b.ts");
    const leafId = activeTab().activeLeafId;
    useTabsStore.getState().splitPaneWith(id, leafId, { kind: "terminal" }, "row");
    const panes = computeLayout(activeTab().paneTree);
    expect(panes).toHaveLength(2);
    expect(panes.some((p) => p.content.kind === "terminal")).toBe(true);

    const splitId = leafIds(activeTab().paneTree).slice().sort().join("|");
    useTabsStore.getState().resizePane(id, splitId, [0.3, 0.7]);

    useTabsStore.getState().closePane(id, activeTab().activeLeafId);
    expect(leafIds(activeTab().paneTree)).toHaveLength(1);
  });

  it("dedupes note tabs by id and git-graph as a singleton", () => {
    const first = useTabsStore.getState().openNoteTab("note-1", "X");
    const again = useTabsStore.getState().openNoteTab("note-1", "X");
    expect(again).toBe(first);

    const g1 = useTabsStore.getState().openGitGraphTab();
    const g2 = useTabsStore.getState().openGitGraphTab();
    expect(g2).toBe(g1);
  });

  it("does not dedupe an editor tab once it has been split", () => {
    const first = useTabsStore.getState().openEditorTab("/a/b.ts");
    useTabsStore
      .getState()
      .splitPaneWith(first, activeTab().activeLeafId, { kind: "terminal" }, "row");
    const second = useTabsStore.getState().openEditorTab("/a/b.ts");
    expect(second).not.toBe(first);
  });

  it("closing the last pane closes the whole tab", () => {
    const id = useTabsStore.getState().newTerminalTab();
    const leafId = activeTab().activeLeafId;
    useTabsStore.getState().closePane(id, leafId);
    expect(useTabsStore.getState().tabs.find((t) => t.id === id)).toBeUndefined();
  });

  it("closing one pane of a split keeps the tab and collapses the tree", () => {
    const id = useTabsStore.getState().newTerminalTab();
    const firstLeaf = activeTab().activeLeafId;
    useTabsStore.getState().splitActivePane("col");
    useTabsStore.getState().closePane(id, activeTab().activeLeafId);
    const tab = activeTab();
    expect(leafIds(tab.paneTree)).toEqual([firstLeaf]);
  });

  it("activates a neighbour when the active tab closes", () => {
    const a = useTabsStore.getState().newTerminalTab();
    const b = useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().closeTab(b);
    expect(useTabsStore.getState().activeId).toBe(a);
  });

  it("creates a default space for the first tab", () => {
    useTabsStore.getState().newTerminalTab();
    const s = useTabsStore.getState();
    expect(s.spaces).toHaveLength(1);
    expect(s.tabs[0].spaceId).toBe(s.activeSpaceId);
  });

  it("names a terminal tab after its folder", () => {
    useTabsStore.getState().newTerminalTab("/Users/muki/Documents/proj");
    expect(useTabsStore.getState().tabs[0].title).toBe("proj");
  });

  it("keeps tabs in separate spaces and switches between them", () => {
    const first = useTabsStore.getState().newTerminalTab();
    const firstSpace = useTabsStore.getState().activeSpaceId;
    const secondSpace = useTabsStore.getState().newSpace();
    expect(useTabsStore.getState().activeId).toBeNull();
    const second = useTabsStore.getState().newTerminalTab();
    expect(useTabsStore.getState().tabs.find((t) => t.id === second)?.spaceId).toBe(
      secondSpace,
    );

    useTabsStore.getState().setActiveSpace(firstSpace!);
    expect(useTabsStore.getState().activeSpaceId).toBe(firstSpace);
    expect(useTabsStore.getState().activeId).toBe(first);
  });

  it("activating a tab also activates its space", () => {
    const first = useTabsStore.getState().newTerminalTab();
    const firstSpace = useTabsStore.getState().activeSpaceId;
    useTabsStore.getState().newSpace();
    useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().setActive(first);
    expect(useTabsStore.getState().activeSpaceId).toBe(firstSpace);
  });

  it("renames a space", () => {
    useTabsStore.getState().newTerminalTab();
    const space = useTabsStore.getState().activeSpaceId!;
    useTabsStore.getState().renameSpace(space, "Project A");
    expect(useTabsStore.getState().spaces.find((s) => s.id === space)?.name).toBe(
      "Project A",
    );
  });

  it("deletes a space with its tabs and falls back to another space", () => {
    useTabsStore.getState().newTerminalTab();
    const first = useTabsStore.getState().activeSpaceId!;
    const second = useTabsStore.getState().newSpace();
    useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().deleteSpace(second);
    expect(useTabsStore.getState().spaces.find((s) => s.id === second)).toBeUndefined();
    expect(useTabsStore.getState().tabs.every((t) => t.spaceId !== second)).toBe(true);
    expect(useTabsStore.getState().activeSpaceId).toBe(first);
  });

  it("opens a launcher tab and activates it", () => {
    const id = useTabsStore.getState().openLauncherTab();
    expect(useTabsStore.getState().activeId).toBe(id);
    expect(activeTab().kind).toBe("launcher");
  });

  it("reuses an existing launcher tab in the same space", () => {
    const first = useTabsStore.getState().openLauncherTab();
    useTabsStore.getState().newTerminalTab();
    const again = useTabsStore.getState().openLauncherTab();
    expect(again).toBe(first);
    expect(useTabsStore.getState().tabs.filter((t) => t.kind === "launcher")).toHaveLength(1);
  });

  it("closes the right/bottom-most pane first, keeping the tab", () => {
    useTabsStore.getState().newTerminalTab();
    // The original pane is the terminal (left); the split adds a launcher (right).
    useTabsStore.getState().splitActivePane("row");
    useTabsStore.getState().closePaneOrTab();
    const panes = computeLayout(activeTab().paneTree);
    expect(panes).toHaveLength(1);
    expect(panes[0].content).toEqual({ kind: "terminal" });
  });

  it("closes the whole tab once a single pane remains", () => {
    const id = useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().closePaneOrTab();
    expect(useTabsStore.getState().tabs.find((t) => t.id === id)).toBeUndefined();
  });

  it("saves a terminal pane's cwd into its layout leaf", () => {
    const id = useTabsStore.getState().newTerminalTab();
    const leafId = activeTab().activeLeafId;
    useTabsStore.getState().setTerminalCwd(id, leafId, "/work/dir");
    expect(firstLeafContent(activeTab())).toEqual({ kind: "terminal", cwd: "/work/dir" });
  });

  it("leaves a non-terminal pane untouched", () => {
    const id = useTabsStore.getState().openEditorTab("/a/b.ts");
    const leafId = activeTab().activeLeafId;
    useTabsStore.getState().setTerminalCwd(id, leafId, "/work/dir");
    expect(firstLeafContent(activeTab())).toEqual({ kind: "editor", path: "/a/b.ts" });
  });

  it("does not rewrite state when the cwd is unchanged", () => {
    const id = useTabsStore.getState().newTerminalTab();
    const leafId = activeTab().activeLeafId;
    useTabsStore.getState().setTerminalCwd(id, leafId, "/work/dir");
    const before = useTabsStore.getState().tabs;
    useTabsStore.getState().setTerminalCwd(id, leafId, "/work/dir");
    expect(useTabsStore.getState().tabs).toBe(before);
  });

  it("reorders tabs within the same space", () => {
    const a = useTabsStore.getState().newTerminalTab();
    const b = useTabsStore.getState().newTerminalTab();
    const c = useTabsStore.getState().newTerminalTab();
    // initial order in this space: [a, b, c]
    useTabsStore.getState().reorderTab(c, a);
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([c, a, b]);
  });

  it("reordering one space leaves other spaces' tabs in place", () => {
    const a1 = useTabsStore.getState().newTerminalTab();
    const space1 = useTabsStore.getState().activeSpaceId!;
    useTabsStore.getState().newSpace();
    const b1 = useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().setActiveSpace(space1);
    const a2 = useTabsStore.getState().newTerminalTab();
    const a3 = useTabsStore.getState().newTerminalTab();
    // Flat order is [a1, b1, a2, a3]; space1 subsequence is [a1, a2, a3].
    useTabsStore.getState().reorderTab(a3, a1);
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([a3, b1, a1, a2]);
  });

  it("reordering does not change the active tab", () => {
    const a = useTabsStore.getState().newTerminalTab();
    const b = useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().setActive(a);
    useTabsStore.getState().reorderTab(b, a);
    expect(useTabsStore.getState().activeId).toBe(a);
  });

  it("is a no-op when dropping on itself or onto an unknown tab", () => {
    const a = useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().newTerminalTab();
    const before = useTabsStore.getState().tabs;
    useTabsStore.getState().reorderTab(a, a);
    expect(useTabsStore.getState().tabs).toBe(before);
    useTabsStore.getState().reorderTab(a, "nope");
    expect(useTabsStore.getState().tabs).toBe(before);
  });

  it("is a no-op when the two tabs are in different spaces", () => {
    const a = useTabsStore.getState().newTerminalTab(); // space1
    useTabsStore.getState().newSpace(); // space2 becomes active
    const c = useTabsStore.getState().newTerminalTab(); // space2
    const before = useTabsStore.getState().tabs;
    useTabsStore.getState().reorderTab(a, c);
    expect(useTabsStore.getState().tabs).toBe(before);
  });
});

describe("openSshTab", () => {
  beforeEach(reset);

  it("opens a terminal tab whose pane carries the ssh connectionId and titles it by name", () => {
    const tabId = useTabsStore.getState().openSshTab("c1", "prod-box");
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab).toBeDefined();
    expect(tab.title).toBe("prod-box");
    expect(tab.kind).toBe("terminal");
    // The tab is user-named so cwd sync won't overwrite the title.
    expect(tab.renamed).toBe(true);
    // The single leaf pane carries the ssh connectionId.
    const pane = firstLeafContent(tab);
    expect(pane).toMatchObject({ kind: "terminal", ssh: { connectionId: "c1" } });
  });

  it("activates the new ssh tab", () => {
    const tabId = useTabsStore.getState().openSshTab("c2", "staging");
    expect(useTabsStore.getState().activeId).toBe(tabId);
  });

  it("focuses the existing tab instead of opening a duplicate for the same connection", () => {
    const first = useTabsStore.getState().openSshTab("c1", "prod-box");
    // Move focus away so we can prove the second call re-focuses the first tab.
    useTabsStore.getState().newTerminalTab();
    const second = useTabsStore.getState().openSshTab("c1", "prod-box");
    expect(second).toBe(first);
    expect(useTabsStore.getState().activeId).toBe(first);
    const sshTabs = useTabsStore
      .getState()
      .tabs.filter((t) => {
        const pane = firstLeafContent(t);
        return pane.kind === "terminal" && pane.ssh?.connectionId === "c1";
      });
    expect(sshTabs).toHaveLength(1);
  });

  it("opens a separate tab for a different connection", () => {
    const first = useTabsStore.getState().openSshTab("c1", "prod-box");
    const second = useTabsStore.getState().openSshTab("c2", "staging");
    expect(second).not.toBe(first);
  });
});

describe("openLogTab", () => {
  beforeEach(reset);

  it("creates a log tab with kind='log', correct title, and pane content on first call", () => {
    const id = useTabsStore.getState().openLogTab("20260507_143343_zsh.log");
    expect(useTabsStore.getState().activeId).toBe(id);
    const tab = activeTab();
    expect(tab.kind).toBe("log");
    expect(tab.title).toBe("20260507_143343_zsh.log");
    expect(firstLeafContent(tab)).toEqual({ kind: "log", logName: "20260507_143343_zsh.log" });
    expect(leafIds(tab.paneTree)).toHaveLength(1);
  });

  it("reuses the same tab id and replaces content when called with a different log name", () => {
    const id = useTabsStore.getState().openLogTab("first.log");
    useTabsStore.getState().newTerminalTab();
    const id2 = useTabsStore.getState().openLogTab("second.log");
    expect(id2).toBe(id);
    expect(useTabsStore.getState().activeId).toBe(id);
    expect(useTabsStore.getState().tabs.filter((t) => t.kind === "log")).toHaveLength(1);
    const tab = useTabsStore.getState().tabs.find((t) => t.id === id)!;
    expect(tab.title).toBe("second.log");
    expect(firstLeafContent(tab)).toEqual({ kind: "log", logName: "second.log" });
  });

  it("preserves split layout when replacing log content in a split log tab", () => {
    // Open a log tab, then split it so the paneTree is no longer a single leaf.
    const id = useTabsStore.getState().openLogTab("first.log");
    const tab0 = useTabsStore.getState().tabs.find((t) => t.id === id)!;
    const originalLeafId = tab0.activeLeafId;
    // Split the active pane (adds a second pane).
    useTabsStore.getState().splitActivePane("row");
    const splitTab = useTabsStore.getState().tabs.find((t) => t.id === id)!;
    expect(leafIds(splitTab.paneTree)).toHaveLength(2);

    // Focus the original (log) leaf so openLogTab replaces it.
    useTabsStore.getState().setActiveLeaf(id, originalLeafId);

    // Calling openLogTab again should reuse the tab AND keep the split intact.
    const id2 = useTabsStore.getState().openLogTab("second.log");
    expect(id2).toBe(id);
    const updated = useTabsStore.getState().tabs.find((t) => t.id === id)!;
    // Split must still have 2 leaves — not collapsed to 1.
    expect(leafIds(updated.paneTree)).toHaveLength(2);
    // The active leaf (the log pane) should show the new log name.
    const panes = computeLayout(updated.paneTree);
    const logPane = panes.find((p) => p.id === updated.activeLeafId);
    expect(logPane?.content).toEqual({ kind: "log", logName: "second.log" });
    expect(updated.title).toBe("second.log");
  });
});

describe("migratePersistedTabs", () => {
  it("migrates v0 simple tabs into single-leaf pane tabs", () => {
    const v0 = {
      spaces: [{ id: "s1", name: "W" }],
      activeSpaceId: "s1",
      activeId: "t2",
      tabs: [
        {
          id: "t1",
          spaceId: "s1",
          kind: "terminal",
          title: "Term",
          paneTree: { kind: "leaf", id: "p0" },
          activeLeafId: "p0",
          cwd: "/tmp",
        },
        { id: "t2", spaceId: "s1", kind: "editor", title: "b.ts", path: "/a/b.ts" },
        { id: "t3", spaceId: "s1", kind: "note", title: "N", noteId: "n1" },
        { id: "t4", spaceId: "s1", kind: "preview", title: "host", url: "http://x" },
        { id: "t5", spaceId: "s1", kind: "git-graph", title: "Git Graph" },
      ],
    };
    const migrated = migratePersistedTabs(v0, 0) as { tabs: Tab[] };
    const byId = (id: string) => migrated.tabs.find((t) => t.id === id)!;

    expect(byId("t1").kind).toBe("terminal");
    expect(byId("t1").cwd).toBe("/tmp");
    expect(leafIds(byId("t2").paneTree)).toHaveLength(1);
    expect(firstLeafContent(byId("t2"))).toEqual({ kind: "editor", path: "/a/b.ts" });
    expect(firstLeafContent(byId("t3"))).toEqual({ kind: "note", noteId: "n1" });
    expect(firstLeafContent(byId("t4"))).toEqual({ kind: "preview", url: "http://x" });
    expect(firstLeafContent(byId("t5"))).toEqual({ kind: "git-graph" });
    expect(byId("t2").title).toBe("b.ts");
    expect(byId("t2").activeLeafId).toBe(leafIds(byId("t2").paneTree)[0]);
  });
});

describe("tabHasDirtyEditor", () => {
  function editorTab(id: string, leafId: string, path: string): Tab {
    return {
      id,
      spaceId: "s1",
      title: "x",
      kind: "editor",
      paneTree: leaf(leafId, { kind: "editor", path }),
      activeLeafId: leafId,
    };
  }

  it("returns false for a terminal tab with no editor panes", () => {
    const tab: Tab = {
      id: "t1",
      spaceId: "s1",
      title: "x",
      kind: "terminal",
      paneTree: leaf("l1", { kind: "terminal" }),
      activeLeafId: "l1",
    };
    expect(tabHasDirtyEditor(tab, {})).toBe(false);
  });

  it("returns false for an editor tab with a clean buffer", () => {
    const tab = editorTab("t1", "l1", "/a/b.ts");
    const buffers = { "/a/b.ts": { content: "hello", baseline: "hello" } };
    expect(tabHasDirtyEditor(tab, buffers)).toBe(false);
  });

  it("returns false when the buffer has not been loaded yet", () => {
    const tab = editorTab("t1", "l1", "/a/b.ts");
    expect(tabHasDirtyEditor(tab, {})).toBe(false);
  });

  it("returns true when an editor pane has unsaved changes", () => {
    const tab = editorTab("t1", "l1", "/a/b.ts");
    const buffers = { "/a/b.ts": { content: "changed", baseline: "original" } };
    expect(tabHasDirtyEditor(tab, buffers)).toBe(true);
  });

  it("returns true when any pane in a split tab is dirty", () => {
    const tree = splitLeaf(
      leaf("l1", { kind: "editor", path: "/a/clean.ts" }),
      "l1",
      "row",
      "l2",
      { kind: "editor", path: "/a/dirty.ts" },
    );
    const tab: Tab = {
      id: "t1",
      spaceId: "s1",
      title: "x",
      kind: "editor",
      paneTree: tree,
      activeLeafId: "l1",
    };
    const buffers = {
      "/a/clean.ts": { content: "ok", baseline: "ok" },
      "/a/dirty.ts": { content: "changed", baseline: "original" },
    };
    expect(tabHasDirtyEditor(tab, buffers)).toBe(true);
  });
});

describe("openHtmlPreview", () => {
  beforeEach(reset);

  it("splits beside a single-pane editor tab", () => {
    const store = useTabsStore.getState();
    const tabId = store.openEditorTab("/proj/a.html");
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    useTabsStore.getState().openHtmlPreview(tabId, tab.activeLeafId, "/proj/a.html");
    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneTree.kind).toBe("split");
    const kinds = leafIds(updated.paneTree).map((id) => findPaneContent(updated.paneTree, id)?.kind);
    expect(kinds).toContain("editor");
    expect(kinds).toContain("preview");
  });

  it("opens a reusable preview tab when the source tab is already split", () => {
    const tabId = useTabsStore.getState().openEditorTab("/proj/b.html");
    // split the editor tab so it has no preview pane but is multi-pane
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    useTabsStore.getState().splitPaneWith(tabId, tab.activeLeafId, { kind: "terminal" }, "row");
    const before = useTabsStore.getState().tabs.length;
    useTabsStore.getState().openHtmlPreview(tabId, tab.activeLeafId, "/proj/b.html");
    const tabs = useTabsStore.getState().tabs;
    expect(tabs.length).toBe(before + 1);
    const previewTab = tabs.find((t) => t.kind === "preview")!;
    expect(previewTab.title).toBe("b.html");
    // a second preview of a different file reuses the same preview tab
    useTabsStore.getState().openHtmlPreview(tabId, tab.activeLeafId, "/proj/c.html");
    expect(useTabsStore.getState().tabs.filter((t) => t.kind === "preview").length).toBe(1);
    expect(useTabsStore.getState().tabs.find((t) => t.kind === "preview")!.title).toBe("c.html");
  });

  it("replaces the preview pane content in place when the tab already has a preview pane", () => {
    const tabId = useTabsStore.getState().openEditorTab("/proj/a.html");
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    const editorLeafId = tab.activeLeafId;
    // Split the editor with a preview pane so the tab already has a preview.
    useTabsStore
      .getState()
      .splitPaneWith(tabId, editorLeafId, { kind: "preview", url: "file:///proj/old.html" }, "row");
    const withPreview = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    const beforeLeafCount = leafIds(withPreview.paneTree).length;
    const beforeTabCount = useTabsStore.getState().tabs.length;
    // After the split the active leaf is the new preview leaf.
    const previewLeafId = withPreview.activeLeafId;

    // Call openHtmlPreview — hits the replace branch.
    useTabsStore.getState().openHtmlPreview(tabId, editorLeafId, "/proj/new.html");
    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;

    // No new leaves and no new tabs.
    expect(leafIds(updated.paneTree)).toHaveLength(beforeLeafCount);
    expect(useTabsStore.getState().tabs).toHaveLength(beforeTabCount);
    // Preview pane now shows the new file url.
    expect(findPaneContent(updated.paneTree, previewLeafId)).toEqual({
      kind: "preview",
      url: "file:///proj/new.html",
    });
    // Active leaf points at the preview pane.
    expect(updated.activeLeafId).toBe(previewLeafId);
  });
});

describe("localPreviewFilePaths", () => {
  it("includes the decoded local path for a file:// preview pane", () => {
    const tab: Tab = {
      id: "t1",
      spaceId: "s1",
      title: "a.html",
      kind: "preview",
      paneTree: leaf("l1", { kind: "preview", url: "file:///proj/a.html" }),
      activeLeafId: "l1",
    };
    expect(localPreviewFilePaths([tab])).toContain("/proj/a.html");
  });

  it("excludes web preview urls (http://)", () => {
    const tab: Tab = {
      id: "t2",
      spaceId: "s1",
      title: "localhost",
      kind: "preview",
      paneTree: leaf("l2", { kind: "preview", url: "http://localhost:3000" }),
      activeLeafId: "l2",
    };
    expect(localPreviewFilePaths([tab])).toHaveLength(0);
  });

  it("contributes nothing for a tab with no preview pane", () => {
    const tab: Tab = {
      id: "t3",
      spaceId: "s1",
      title: "Term",
      kind: "terminal",
      paneTree: leaf("l3", { kind: "terminal" }),
      activeLeafId: "l3",
    };
    expect(localPreviewFilePaths([tab])).toHaveLength(0);
  });
});

describe("activeEditorPath", () => {
  function editorTab(id: string, leafId: string, path: string): Tab {
    return {
      id,
      spaceId: "s1",
      title: "x",
      kind: "editor",
      paneTree: leaf(leafId, { kind: "editor", path }),
      activeLeafId: leafId,
    };
  }

  it("returns the path of the active editor tab", () => {
    const tab = editorTab("t1", "l1", "/repo/App.vue");
    expect(activeEditorPath([tab], "t1")).toBe("/repo/App.vue");
  });

  it("returns null when the active pane is a terminal", () => {
    const tab: Tab = {
      id: "t1",
      spaceId: "s1",
      title: "x",
      kind: "terminal",
      paneTree: leaf("l1", { kind: "terminal" }),
      activeLeafId: "l1",
    };
    expect(activeEditorPath([tab], "t1")).toBeNull();
  });

  it("returns null when there is no active tab", () => {
    const tab = editorTab("t1", "l1", "/repo/App.vue");
    expect(activeEditorPath([tab], null)).toBeNull();
    expect(activeEditorPath([tab], "missing")).toBeNull();
  });

  it("tracks the focused pane in a split tab", () => {
    // editor on the left, a terminal split into the right.
    const tree = splitLeaf(
      leaf("l1", { kind: "editor", path: "/repo/App.vue" }),
      "l1",
      "row",
      "l2",
      { kind: "terminal" },
    );
    const tab: Tab = {
      id: "t1",
      spaceId: "s1",
      title: "x",
      kind: "editor",
      paneTree: tree,
      activeLeafId: "l1",
    };
    expect(activeEditorPath([tab], "t1")).toBe("/repo/App.vue");
    expect(activeEditorPath([{ ...tab, activeLeafId: "l2" }], "t1")).toBeNull();
  });
});
