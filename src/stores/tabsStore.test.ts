import { beforeEach, describe, expect, it } from "vitest";
import {
  activeEditorPath,
  localPreviewFilePaths,
  openEditorPaths,
  sshAlreadyOpen,
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
import { consumeFreshSshLeaf } from "@/modules/ssh/lib/freshSshLeaves";

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

describe("navigatePreview", () => {
  beforeEach(reset);

  it("updates a single-pane preview tab's url and title to the new host", () => {
    const id = useTabsStore.getState().openPreviewTab("http://localhost:3000");
    const leafId = activeTab().activeLeafId;
    expect(activeTab().title).toBe("localhost:3000");

    useTabsStore.getState().navigatePreview(id, leafId, "https://muki.tw/wp-admin");

    const tab = activeTab();
    expect(firstLeafContent(tab)).toEqual({
      kind: "preview",
      url: "https://muki.tw/wp-admin",
    });
    expect(tab.title).toBe("muki.tw");
  });

  it("updates only the url, not the tab title, when the preview is one pane of several", () => {
    const tabId = useTabsStore.getState().openEditorTab("/a/b.ts");
    const editorLeafId = activeTab().activeLeafId;
    useTabsStore
      .getState()
      .splitPaneWith(tabId, editorLeafId, { kind: "preview", url: "http://localhost:3000" }, "row");
    const previewLeafId = activeTab().activeLeafId;

    useTabsStore.getState().navigatePreview(tabId, previewLeafId, "https://muki.tw/wp-admin");

    const tab = activeTab();
    expect(findPaneContent(tab.paneTree, previewLeafId)).toEqual({
      kind: "preview",
      url: "https://muki.tw/wp-admin",
    });
    expect(tab.title).toBe("b.ts");
  });

  it("keeps a user-renamed preview tab's title when navigating", () => {
    const id = useTabsStore.getState().openPreviewTab("http://localhost:3000");
    const leafId = activeTab().activeLeafId;
    useTabsStore.getState().setTabTitle(id, "My Site");

    useTabsStore.getState().navigatePreview(id, leafId, "https://muki.tw/wp-admin");

    const tab = activeTab();
    expect(firstLeafContent(tab)).toEqual({
      kind: "preview",
      url: "https://muki.tw/wp-admin",
    });
    expect(tab.title).toBe("My Site");
  });

  it("is a no-op when the leaf is not a preview pane", () => {
    const id = useTabsStore.getState().newTerminalTab("/a/proj");
    const leafId = activeTab().activeLeafId;

    useTabsStore.getState().navigatePreview(id, leafId, "https://muki.tw");

    const tab = activeTab();
    expect(tab.title).toBe("proj");
    expect(firstLeafContent(tab).kind).toBe("terminal");
  });
});

describe("setPreviewTabTitle", () => {
  beforeEach(reset);

  it("retitles a single-pane preview tab from the page title", () => {
    const id = useTabsStore.getState().openPreviewTab("http://localhost:3000");
    const leafId = activeTab().activeLeafId;

    useTabsStore.getState().setPreviewTabTitle(id, leafId, "  My Cool Page  ");

    expect(activeTab().title).toBe("My Cool Page");
  });

  it("ignores an empty title", () => {
    const id = useTabsStore.getState().openPreviewTab("http://localhost:3000");
    const leafId = activeTab().activeLeafId;

    useTabsStore.getState().setPreviewTabTitle(id, leafId, "   ");

    expect(activeTab().title).toBe("localhost:3000");
  });

  it("does not retitle when the preview is one pane of several", () => {
    const tabId = useTabsStore.getState().openEditorTab("/a/b.ts");
    const editorLeafId = activeTab().activeLeafId;
    useTabsStore
      .getState()
      .splitPaneWith(tabId, editorLeafId, { kind: "preview", url: "http://localhost:3000" }, "row");
    const previewLeafId = activeTab().activeLeafId;

    useTabsStore.getState().setPreviewTabTitle(tabId, previewLeafId, "My Cool Page");

    expect(activeTab().title).toBe("b.ts");
  });

  it("keeps a user-renamed tab's title", () => {
    const id = useTabsStore.getState().openPreviewTab("http://localhost:3000");
    const leafId = activeTab().activeLeafId;
    useTabsStore.getState().setTabTitle(id, "My Site");

    useTabsStore.getState().setPreviewTabTitle(id, leafId, "Page Title");

    expect(activeTab().title).toBe("My Site");
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

  it("creates a diff tab titled by basename and focuses the same file on re-open", () => {
    const first = useTabsStore.getState().openDiffTab("/repo/src/App.tsx", false);
    expect(activeTab().title).toBe("App.tsx");
    expect(firstLeafContent(activeTab())).toEqual({
      kind: "diff",
      path: "/repo/src/App.tsx",
      staged: false,
    });
    const again = useTabsStore.getState().openDiffTab("/repo/src/App.tsx", false);
    expect(again).toBe(first);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("treats staged and unstaged diffs of the same file as distinct tabs", () => {
    useTabsStore.getState().openDiffTab("/repo/a.ts", false);
    useTabsStore.getState().openDiffTab("/repo/a.ts", true);
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("dedupes note tabs by id and git-graph as a singleton", () => {
    const first = useTabsStore.getState().openNoteTab("note-1", "X");
    const again = useTabsStore.getState().openNoteTab("note-1", "X");
    expect(again).toBe(first);

    const g1 = useTabsStore.getState().openGitGraphTab();
    const g2 = useTabsStore.getState().openGitGraphTab();
    expect(g2).toBe(g1);
  });

  it("opens a sessions tab as a singleton, focusing the existing one", () => {
    const s1 = useTabsStore.getState().openSessionsTab();
    expect(activeTab().kind).toBe("sessions");
    expect(activeTab().title).toBe("AI Sessions");
    expect(firstLeafContent(activeTab())).toEqual({ kind: "sessions" });

    const s2 = useTabsStore.getState().openSessionsTab();
    expect(s2).toBe(s1);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().activeId).toBe(s1);
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

  it("focuses the first remaining pane after closing the active pane", () => {
    const id = useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().splitActivePane("row");
    useTabsStore.getState().splitActivePane("row");
    const ids = leafIds(activeTab().paneTree);
    expect(ids).toHaveLength(3);
    // Focus and close the middle pane; focus must land on the first remaining
    // pane, not the last.
    useTabsStore.setState({
      tabs: useTabsStore.getState().tabs.map((t) =>
        t.id === id ? { ...t, activeLeafId: ids[1] } : t,
      ),
    });
    useTabsStore.getState().closePane(id, ids[1]);
    expect(leafIds(activeTab().paneTree)).toEqual([ids[0], ids[2]]);
    expect(activeTab().activeLeafId).toBe(ids[0]);
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

  it("seeds the requested cwd onto the pane content so it wins over the explorer root", () => {
    // "Open terminal here" (project view) needs the requested cwd as the pane's
    // OWN cwd: resolveTerminalCwd ranks paneCwd above the explorer root, so a
    // bare tab-level cwd would be overridden whenever a folder is open.
    useTabsStore.getState().newTerminalTab("/a/proj");
    const leafId = activeTab().activeLeafId;
    expect(findPaneContent(activeTab().paneTree, leafId)).toEqual({ kind: "terminal", cwd: "/a/proj" });
  });

  it("leaves the pane cwd unset for a plain new terminal", () => {
    useTabsStore.getState().newTerminalTab();
    const leafId = activeTab().activeLeafId;
    expect(findPaneContent(activeTab().paneTree, leafId)).toEqual({ kind: "terminal" });
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

describe("paneOrder on tab creation", () => {
  beforeEach(reset);

  it("initializes paneOrder to the sole leaf for every tab-creating action", () => {
    const cases: Array<() => string> = [
      () => useTabsStore.getState().newTerminalTab(),
      () => useTabsStore.getState().openSshTab("c1", "box"),
      () => useTabsStore.getState().openLauncherTab(),
      () => useTabsStore.getState().openEditorTab("/a.ts"),
      () => useTabsStore.getState().openNoteTab("/n.md", "note"),
      () => useTabsStore.getState().openPreviewTab("http://localhost"),
      () => useTabsStore.getState().openGitGraphTab(),
    ];
    for (const create of cases) {
      reset();
      const tabId = create();
      const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
      expect(tab.paneOrder).toEqual([tab.activeLeafId]);
    }
  });

  it("initializes paneOrder for a tab opened via openFromSidebar", () => {
    useTabsStore.getState().openFromSidebar({ kind: "editor", path: "/a.ts" });
    const tab = activeTab();
    expect(tab.id).toBe(useTabsStore.getState().activeId);
    expect(tab.paneOrder).toEqual([tab.activeLeafId]);
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

  it("preserves a non-terminal tab's real multi-leaf split when it survives migration", () => {
    const multiLeafTree = splitLeaf(
      leaf("e1", { kind: "editor", path: "/a/b.ts" }),
      "e1",
      "row",
      "t1",
      { kind: "terminal" },
    );

    const v1WithoutPaneOrder = {
      spaces: [{ id: "s1", name: "W" }],
      activeSpaceId: "s1",
      activeId: "tab1",
      tabs: [
        {
          id: "tab1",
          spaceId: "s1",
          kind: "editor",
          title: "split-editor",
          path: "/a/b.ts",
          paneTree: multiLeafTree,
          activeLeafId: "e1",
          // no paneOrder — simulating pre-paneOrder v1 persisted data
        },
      ],
    };

    const migrated = migratePersistedTabs(v1WithoutPaneOrder, 0) as { tabs: Tab[] };
    const tab = migrated.tabs[0]!;

    expect(tab.paneTree).toBe(multiLeafTree);
    expect(tab.activeLeafId).toBe("e1");
    expect(tab.paneOrder).toEqual(leafIds(multiLeafTree));
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
      paneOrder: [leafId],
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
      paneOrder: ["l1"],
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
      paneOrder: ["l1", "l2"],
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

describe("splitPaneWith", () => {
  beforeEach(reset);

  it("returns the id of the newly created leaf", () => {
    const tabId = useTabsStore.getState().openEditorTab("/a.ts");
    const original = activeTab();
    const newLeafId = useTabsStore
      .getState()
      .splitPaneWith(tabId, original.activeLeafId, { kind: "editor", path: "/b.ts" }, "row");

    const updated = activeTab();
    expect(updated.activeLeafId).toBe(newLeafId);
    expect(findPaneContent(updated.paneTree, newLeafId)).toMatchObject({
      kind: "editor",
      path: "/b.ts",
    });
  });
});

describe("splitPaneWith anchor", () => {
  beforeEach(reset);

  it("defaults to placing the new pane after the existing one (unchanged behavior)", () => {
    const tabId = useTabsStore.getState().newTerminalTab();
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    const newId = useTabsStore.getState().splitPaneWith(
      tabId,
      tab.activeLeafId,
      { kind: "editor", path: "/a.ts" },
      "row",
    );
    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneTree).toEqual({
      kind: "split",
      direction: "row",
      children: [
        { kind: "leaf", id: tab.activeLeafId, pane: { kind: "terminal" } },
        { kind: "leaf", id: newId, pane: { kind: "editor", path: "/a.ts" } },
      ],
      sizes: [0.5, 0.5],
    });
  });

  it("places the new pane before the existing one when anchor is \"before\"", () => {
    const tabId = useTabsStore.getState().newTerminalTab();
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    const newId = useTabsStore.getState().splitPaneWith(
      tabId,
      tab.activeLeafId,
      { kind: "editor", path: "/a.ts" },
      "row",
      "before",
    );
    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneTree).toEqual({
      kind: "split",
      direction: "row",
      children: [
        { kind: "leaf", id: newId, pane: { kind: "editor", path: "/a.ts" } },
        { kind: "leaf", id: tab.activeLeafId, pane: { kind: "terminal" } },
      ],
      sizes: [0.5, 0.5],
    });
  });
});

describe("wrapPaneWith", () => {
  beforeEach(reset);

  it("wraps the whole existing tree as the second child, new pane first, for anchor \"before\"", () => {
    const tabId = useTabsStore.getState().newTerminalTab();
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    const existingTree = tab.paneTree;
    const newId = useTabsStore
      .getState()
      .wrapPaneWith(tabId, { kind: "editor", path: "/a.ts" }, "row", "before");
    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneTree).toEqual({
      kind: "split",
      direction: "row",
      children: [
        { kind: "leaf", id: newId, pane: { kind: "editor", path: "/a.ts" } },
        existingTree,
      ],
      sizes: [0.5, 0.5],
    });
    expect(updated.activeLeafId).toBe(newId);
    expect(updated.paneOrder).toContain(newId);
  });
});

describe("sshAlreadyOpen (exported)", () => {
  beforeEach(reset);

  it("is importable and reports false for a connection nobody has opened", () => {
    expect(sshAlreadyOpen(useTabsStore.getState().tabs, "space-1", "conn-x")).toBe(false);
  });
});

describe("splitPaneWith keeps paneOrder in sync", () => {
  beforeEach(reset);

  it("appends the new leaf id to paneOrder", () => {
    const tabId = useTabsStore.getState().openEditorTab("/a.ts");
    const original = activeTab();
    const newLeafId = useTabsStore
      .getState()
      .splitPaneWith(tabId, original.activeLeafId, { kind: "editor", path: "/b.ts" }, "row");

    const updated = activeTab();
    expect(updated.paneOrder).toEqual([original.activeLeafId, newLeafId]);
  });
});

describe("openFromSidebar", () => {
  beforeEach(reset);

  it("opens a brand-new tab when there is no active tab", () => {
    const result = useTabsStore.getState().openFromSidebar({ kind: "editor", path: "/a.ts" });
    expect(result).toEqual({ status: "opened" });
    const tab = activeTab();
    expect(firstLeafContent(tab)).toMatchObject({ kind: "editor", path: "/a.ts" });
    expect(tab.title).toBe("a.ts");
  });

  it("closes the launcher tab and opens a fresh one when the active tab is a launcher", () => {
    // openLauncherTab's tab is identified by kind === "launcher" — TabsArea.tsx
    // renders LauncherPanel for it directly and never looks at its paneTree, so
    // "opening into" a launcher tab means replacing the whole tab, the same way
    // LauncherPanel's own newTab actions do (open elsewhere, close this one).
    const launcherId = useTabsStore.getState().openLauncherTab();
    const result = useTabsStore
      .getState()
      .openFromSidebar({ kind: "editor", path: "/a.ts" }, "a.ts");
    expect(result).toEqual({ status: "opened" });
    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).not.toBe(launcherId);
    expect(tabs[0].kind).toBe("editor");
    expect(firstLeafContent(tabs[0])).toMatchObject({ kind: "editor", path: "/a.ts" });
    expect(tabs[0].title).toBe("a.ts");
    expect(useTabsStore.getState().activeId).toBe(tabs[0].id);
  });

  it("splits a new pane to the right when the active tab already has content", () => {
    useTabsStore.getState().openEditorTab("/a.ts");
    const result = useTabsStore.getState().openFromSidebar({ kind: "editor", path: "/b.ts" });
    expect(result).toEqual({ status: "opened" });
    const tab = activeTab();
    const panes = computeLayout(tab.paneTree);
    expect(panes).toHaveLength(2);
    const rightmost = panes.reduce((a, b) =>
      b.rect.left + b.rect.width > a.rect.left + a.rect.width ? b : a,
    );
    expect(rightmost.content).toMatchObject({ kind: "editor", path: "/b.ts" });
    expect(tab.activeLeafId).toBe(rightmost.id);
  });

  it("keeps splitting to the right on repeated calls, leaving earlier panes untouched", () => {
    useTabsStore.getState().openEditorTab("/a.ts");
    useTabsStore.getState().openFromSidebar({ kind: "editor", path: "/b.ts" });
    useTabsStore.getState().openFromSidebar({ kind: "editor", path: "/c.ts" });
    const tab = activeTab();
    const panes = computeLayout(tab.paneTree);
    expect(panes).toHaveLength(3);
    const sorted = panes.slice().sort((a, b) => a.rect.left - b.rect.left);
    expect(sorted.map((p) => p.content)).toMatchObject([
      { kind: "editor", path: "/a.ts" },
      { kind: "editor", path: "/b.ts" },
      { kind: "editor", path: "/c.ts" },
    ]);
  });

  it("allows the same content to open as a separate pane instead of focusing the existing one", () => {
    useTabsStore.getState().openEditorTab("/a.ts");
    useTabsStore.getState().openFromSidebar({ kind: "editor", path: "/a.ts" });
    const tab = activeTab();
    const panes = computeLayout(tab.paneTree);
    expect(panes).toHaveLength(2);
    expect(panes.filter((p) => p.content.kind === "editor" && p.content.path === "/a.ts")).toHaveLength(2);
  });

  describe("openFromSidebar grid layout for 5+ panes", () => {
    beforeEach(reset);

    function openN(n: number) {
      useTabsStore.getState().openEditorTab("/1.ts");
      for (let i = 2; i <= n; i++) {
        useTabsStore.getState().openFromSidebar({ kind: "editor", path: `/${i}.ts` });
      }
    }

    it("stacks the 5th pane under the 1st column instead of adding a 5th column", () => {
      openN(5);
      const tab = activeTab();
      const panes = computeLayout(tab.paneTree);
      expect(panes).toHaveLength(5);
      const columns = new Set(panes.map((p) => Math.round(p.rect.left)));
      expect(columns.size).toBe(4);
    });

    it("keeps stacking the 6th, 7th, and 8th panes under columns 2, 3, and 4", () => {
      openN(8);
      const tab = activeTab();
      const panes = computeLayout(tab.paneTree);
      expect(panes).toHaveLength(8);
      const columns = new Set(panes.map((p) => Math.round(p.rect.left)));
      expect(columns.size).toBe(4);
    });

    it("blocks a 9th pane and does not mutate the tab", () => {
      openN(8);
      const before = activeTab();
      const result = useTabsStore.getState().openFromSidebar({ kind: "editor", path: "/9.ts" });
      expect(result).toEqual({ status: "at-capacity" });
      const after = activeTab();
      expect(after.paneOrder).toEqual(before.paneOrder);
      expect(computeLayout(after.paneTree)).toHaveLength(8);
    });

    it("recalculates the grid when a pane closes, going from 5 back to a clean 4 columns", () => {
      openN(5);
      const tab = activeTab();
      const fifthLeafId = tab.paneOrder[4];
      useTabsStore.getState().closePane(tab.id, fifthLeafId);
      const after = activeTab();
      expect(computeLayout(after.paneTree)).toHaveLength(4);
    });
  });
});

describe("openFromSidebar with ssh content", () => {
  beforeEach(reset);

  it("returns already-connected and does not create a tab when the connection is already open", () => {
    useTabsStore
      .getState()
      .openFromSidebar({ kind: "terminal", ssh: { connectionId: "c1" } }, "prod-box");
    const before = useTabsStore.getState().tabs.length;

    const result = useTabsStore
      .getState()
      .openFromSidebar({ kind: "terminal", ssh: { connectionId: "c1" } }, "prod-box");

    expect(result).toEqual({ status: "already-connected" });
    expect(useTabsStore.getState().tabs).toHaveLength(before);
  });

  it("opens a new connection normally when it is not already open", () => {
    const result = useTabsStore
      .getState()
      .openFromSidebar({ kind: "terminal", ssh: { connectionId: "c1" } }, "prod-box");
    expect(result).toEqual({ status: "opened" });
    const tab = activeTab();
    expect(firstLeafContent(tab)).toMatchObject({
      kind: "terminal",
      ssh: { connectionId: "c1" },
    });
  });

  it("marks a freshly split ssh pane so it auto-connects", () => {
    useTabsStore.getState().openEditorTab("/a.ts");
    useTabsStore
      .getState()
      .openFromSidebar({ kind: "terminal", ssh: { connectionId: "c1" } }, "prod-box");
    const tab = activeTab();
    expect(consumeFreshSshLeaf(tab.activeLeafId)).toBe(true);
  });
});

describe("openInNewTab", () => {
  beforeEach(reset);

  it("always creates a brand-new tab even when there is content already open", () => {
    useTabsStore.getState().openEditorTab("/a.ts");
    const result = useTabsStore.getState().openInNewTab({ kind: "editor", path: "/a.ts" });
    expect(result).toEqual({ status: "opened" });
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("does not split into the active tab, even when the active tab has room", () => {
    useTabsStore.getState().openEditorTab("/a.ts");
    useTabsStore.getState().openInNewTab({ kind: "note", noteId: "/n.md" }, "note");
    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(2);
    expect(computeLayout(tabs[0].paneTree)).toHaveLength(1);
    expect(computeLayout(tabs[1].paneTree)).toHaveLength(1);
  });

  it("initializes paneOrder on the new tab", () => {
    useTabsStore.getState().openInNewTab({ kind: "editor", path: "/a.ts" });
    const tab = activeTab();
    expect(tab.paneOrder).toEqual([tab.activeLeafId]);
  });

  it("does not touch or close an existing Launcher tab", () => {
    const launcherId = useTabsStore.getState().openLauncherTab();
    useTabsStore.getState().openInNewTab({ kind: "editor", path: "/a.ts" });
    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs.some((t) => t.id === launcherId)).toBe(true);
  });

  it("blocks and returns already-connected for an ssh connection already open, without creating a tab", () => {
    useTabsStore.getState().openInNewTab({ kind: "terminal", ssh: { connectionId: "c1" } }, "box");
    const before = useTabsStore.getState().tabs.length;

    const result = useTabsStore
      .getState()
      .openInNewTab({ kind: "terminal", ssh: { connectionId: "c1" } }, "box");

    expect(result).toEqual({ status: "already-connected" });
    expect(useTabsStore.getState().tabs).toHaveLength(before);
  });

  it("marks a freshly opened ssh pane so it auto-connects", () => {
    useTabsStore.getState().openInNewTab({ kind: "terminal", ssh: { connectionId: "c1" } }, "box");
    const tab = activeTab();
    expect(consumeFreshSshLeaf(tab.activeLeafId)).toBe(true);
  });
});

describe("closePane keeps paneOrder in sync", () => {
  beforeEach(reset);

  it("removes the closed leaf id from paneOrder, preserving the order of survivors", () => {
    const tabId = useTabsStore.getState().openEditorTab("/a.ts");
    const first = activeTab().activeLeafId;
    const second = useTabsStore
      .getState()
      .splitPaneWith(tabId, first, { kind: "editor", path: "/b.ts" }, "row");
    const third = useTabsStore
      .getState()
      .splitPaneWith(tabId, second, { kind: "editor", path: "/c.ts" }, "row");

    useTabsStore.getState().closePane(tabId, second);

    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.paneOrder).toEqual([first, third]);
  });
});

describe("splitActivePane keeps paneOrder in sync (regression: Phase 2 final review)", () => {
  beforeEach(reset);

  it("appends the new leaf to paneOrder", () => {
    const tabId = useTabsStore.getState().openEditorTab("/a.ts");
    useTabsStore.getState().splitActivePane("row");
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.paneOrder).toHaveLength(2);
  });

  it("does not lose the Cmd+D pane when a sidebar click runs the grid rebuild afterward", () => {
    useTabsStore.getState().openEditorTab("/a.ts");
    useTabsStore.getState().splitActivePane("row");
    const afterSplit = activeTab();
    expect(afterSplit.paneOrder).toHaveLength(2);

    useTabsStore.getState().openFromSidebar({ kind: "editor", path: "/b.ts" });
    const afterSidebarClick = activeTab();
    expect(afterSidebarClick.paneOrder).toHaveLength(3);
    const panes = computeLayout(afterSidebarClick.paneTree);
    expect(panes).toHaveLength(3);
    // The Cmd+D pane (a fresh launcher leaf) must still be present, not dropped.
    expect(panes.some((p) => p.content.kind === "launcher")).toBe(true);
  });

  it("does not add a 9th pane when the tab already has 8", () => {
    useTabsStore.getState().openEditorTab("/0.ts");
    for (let i = 1; i < 8; i++) {
      useTabsStore.getState().openFromSidebar({ kind: "editor", path: `/${i}.ts` });
    }
    const before = activeTab();
    expect(before.paneOrder).toHaveLength(8);

    useTabsStore.getState().splitActivePane("row");

    const after = activeTab();
    expect(after.paneOrder).toEqual(before.paneOrder);
    expect(computeLayout(after.paneTree)).toHaveLength(8);
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
      paneOrder: ["l1"],
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
      paneOrder: ["l2"],
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
      paneOrder: ["l3"],
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
      paneOrder: [leafId],
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
      paneOrder: ["l1"],
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
      paneOrder: ["l1", "l2"],
    };
    expect(activeEditorPath([tab], "t1")).toBe("/repo/App.vue");
    expect(activeEditorPath([{ ...tab, activeLeafId: "l2" }], "t1")).toBeNull();
  });
});
