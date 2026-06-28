import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { uid } from "@/lib/id";
import { perWindowStorage } from "@/lib/window";
import { markFreshSshLeaf } from "@/modules/ssh/lib/freshSshLeaves";
import {
  computeLayout,
  findPaneContent,
  firstLeafId,
  leaf,
  leafIds,
  paneOf,
  removeLeaf,
  setLeafPane,
  setSizesById,
  splitLeaf,
  type LayoutNode,
  type PaneContent,
  type SplitDirection,
} from "@/modules/terminal/lib/terminalLayout";

/**
 * Tabs grouped into spaces. A space is a context (like a window) that holds its
 * own set of tabs. Every tab owns a recursive split paneTree, so any tab can be
 * split into panes of mixed content (terminal/editor/note/preview/git-graph),
 * just like a terminal tab. Tabs stay mounted when inactive (hidden) so
 * terminals keep running.
 */
export interface Space {
  id: string;
  name: string;
}

export type TabKind = "terminal" | "editor" | "note" | "preview" | "git-graph" | "launcher" | "log";

/**
 * A single tab. `kind` is only the tab's creation type, used for the tab-bar
 * icon and open-dedup; it does not have to match a split's mixed contents (a
 * terminal tab split with an editor still shows the terminal icon).
 */
export interface Tab {
  id: string;
  spaceId: string;
  title: string;
  kind: TabKind;
  paneTree: LayoutNode;
  activeLeafId: string;
  /** Starting directory for new terminal panes created inside this tab. */
  cwd?: string;
  /** True once the user renames the tab, so cwd changes stop overwriting it. */
  renamed?: boolean;
}

interface TabsState {
  spaces: Space[];
  activeSpaceId: string | null;
  tabs: Tab[];
  activeId: string | null;
  ensureSpace: () => string;
  newSpace: (name?: string) => string;
  setActiveSpace: (id: string) => void;
  renameSpace: (id: string, name: string) => void;
  deleteSpace: (id: string) => void;
  newTerminalTab: (cwd?: string) => string;
  /** Open a terminal tab wired to an SSH connection. The tab is user-named (renamed=true) so cwd sync never overwrites the title. */
  openSshTab: (connectionId: string, name: string) => string;
  /** A blank "new tab" showing the launcher; reused if one already exists. */
  openLauncherTab: () => string;
  openEditorTab: (path: string) => string;
  openNoteTab: (noteId: string, title: string) => string;
  openPreviewTab: (url: string) => string;
  openGitGraphTab: () => string;
  /**
   * Open the single reusable log tab for this space. If one already exists,
   * replace its pane content + title in place (no new tab) and focus it.
   */
  openLogTab: (logName: string) => string;
  setTabTitle: (id: string, title: string) => void;
  /** Update a terminal tab's title to follow its cwd, unless the user renamed it. */
  syncTabTitleToCwd: (id: string, cwd: string) => void;
  closeTab: (id: string) => void;
  /**
   * Close the next pane of the active tab in reverse reading order (bottom-most,
   * then right-most), falling back to closing the whole tab when one pane is left.
   */
  closePaneOrTab: () => void;
  setActive: (id: string) => void;
  /** Move `activeId` to `overId`'s slot within the same space. No-op across spaces. */
  reorderTab: (activeId: string, overId: string) => void;
  splitActivePane: (direction: SplitDirection) => void;
  setActiveLeaf: (tabId: string, leafId: string) => void;
  /** Cycle the active tab's focused pane to the next leaf (⌘`); wraps around. */
  focusNextPane: () => void;
  resizePane: (tabId: string, splitId: string, sizes: [number, number]) => void;
  /** Split a pane and show `content` (terminal/editor/note/preview) in the new half. */
  splitPaneWith: (
    tabId: string,
    fromLeafId: string,
    content: PaneContent,
    direction: SplitDirection,
  ) => void;
  /** Replace a pane's content in place (used when dropping a file onto it). */
  setPaneContent: (tabId: string, leafId: string, content: PaneContent) => void;
  /** Remember a terminal pane's current working directory for session restore. */
  setTerminalCwd: (tabId: string, leafId: string, cwd: string) => void;
  closePane: (tabId: string, leafId: string) => void;
}

const nextTabId = () => uid("tab");
const nextPaneId = () => uid("pane");
const nextSpaceId = () => uid("space");

function basename(path: string): string {
  const seg = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return seg && seg.length > 0 ? seg : path;
}

function neighbourId(tabs: Tab[], index: number): string | null {
  return tabs[index - 1]?.id ?? tabs[index]?.id ?? null;
}

/** Return a copy of `items` with the element at `from` moved to `to`. */
function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * The file path of the editor the user is currently focused on, derived from
 * the active tab's active leaf so it follows what is actually on screen (including
 * the focused pane of a split). Returns null when the focused pane is not an
 * editor. This is the source of truth for "the file the user is looking at" —
 * the legacy workspaceStore.activeFile was never wired up to tab navigation.
 */
export function activeEditorPath(
  tabs: readonly Tab[],
  activeId: string | null,
): string | null {
  const tab = tabs.find((t) => t.id === activeId);
  if (!tab) {
    return null;
  }
  const content = findPaneContent(tab.paneTree, tab.activeLeafId);
  return content?.kind === "editor" ? content.path : null;
}

export function tabHasDirtyEditor(
  tab: Tab,
  buffers: Record<string, { content: string; baseline: string }>,
): boolean {
  return computeLayout(tab.paneTree).some((p) => {
    if (p.content.kind !== "editor") return false;
    const buf = buffers[p.content.path];
    return buf ? buf.content !== buf.baseline : false;
  });
}

/** Every distinct file path currently shown in an editor pane, across all tabs. */
export function openEditorPaths(tabs: Tab[]): string[] {
  const paths = new Set<string>();
  for (const tab of tabs) {
    for (const pane of computeLayout(tab.paneTree)) {
      if (pane.content.kind === "editor") {
        paths.add(pane.content.path);
      }
    }
  }
  return [...paths];
}

/** True when a tab is a single, unsplit leaf showing exactly `content`. */
function singleLeafContentEquals(tab: Tab, content: PaneContent): boolean {
  if (tab.paneTree.kind !== "leaf") {
    return false;
  }
  const pane = paneOf(tab.paneTree);
  if (pane.kind !== content.kind) {
    return false;
  }
  if (pane.kind === "editor" && content.kind === "editor") {
    return pane.path === content.path;
  }
  if (pane.kind === "note" && content.kind === "note") {
    return pane.noteId === content.noteId;
  }
  if (pane.kind === "preview" && content.kind === "preview") {
    return pane.url === content.url;
  }
  return true;
}

export const TABS_STORAGE_KEY = "tempoterm-tabs";

/** Shape of a tab as persisted before the unified paneTree model (v0). */
interface PersistedV0Tab {
  id: string;
  spaceId: string;
  title: string;
  kind: TabKind;
  path?: string;
  noteId?: string;
  url?: string;
  paneTree?: LayoutNode;
  activeLeafId?: string;
  cwd?: string;
}

/** Convert pre-paneTree (v0) persisted tabs into the unified Tab shape. */
export function migratePersistedTabs(persisted: unknown, _version: number): unknown {
  if (!persisted || typeof persisted !== "object") {
    return persisted;
  }
  const state = persisted as { tabs?: PersistedV0Tab[] };
  if (!Array.isArray(state.tabs)) {
    return persisted;
  }
  const tabs: Tab[] = state.tabs.map((t) => {
    if (t.kind === "terminal" && t.paneTree && t.activeLeafId) {
      return {
        id: t.id,
        spaceId: t.spaceId,
        title: t.title,
        kind: "terminal",
        paneTree: t.paneTree,
        activeLeafId: t.activeLeafId,
        cwd: t.cwd,
      };
    }
    const paneId = nextPaneId();
    let content: PaneContent;
    switch (t.kind) {
      case "editor":
        content = { kind: "editor", path: t.path ?? "" };
        break;
      case "note":
        content = { kind: "note", noteId: t.noteId ?? "" };
        break;
      case "preview":
        content = { kind: "preview", url: t.url ?? "" };
        break;
      case "git-graph":
        content = { kind: "git-graph" };
        break;
      default:
        content = { kind: "terminal" };
    }
    return {
      id: t.id,
      spaceId: t.spaceId,
      title: t.title,
      kind: t.kind,
      paneTree: leaf(paneId, content),
      activeLeafId: paneId,
      cwd: t.cwd,
    };
  });
  return { ...state, tabs };
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
  spaces: [],
  activeSpaceId: null,
  tabs: [],
  activeId: null,

  ensureSpace: () => {
    const current = get().activeSpaceId;
    if (current && get().spaces.some((s) => s.id === current)) {
      return current;
    }
    const id = nextSpaceId();
    const name = `Workspace ${get().spaces.length + 1}`;
    set((state) => ({ spaces: [...state.spaces, { id, name }], activeSpaceId: id }));
    return id;
  },

  newSpace: (name) => {
    const id = nextSpaceId();
    set((state) => ({
      spaces: [...state.spaces, { id, name: name ?? `Workspace ${state.spaces.length + 1}` }],
      activeSpaceId: id,
      activeId: null,
    }));
    return id;
  },

  setActiveSpace: (id) =>
    set((state) => {
      const firstTab = state.tabs.find((t) => t.spaceId === id);
      return { activeSpaceId: id, activeId: firstTab ? firstTab.id : null };
    }),

  renameSpace: (id, name) =>
    set((state) => ({
      spaces: state.spaces.map((s) => (s.id === id ? { ...s, name } : s)),
    })),

  deleteSpace: (id) =>
    set((state) => {
      const spaces = state.spaces.filter((s) => s.id !== id);
      const tabs = state.tabs.filter((t) => t.spaceId !== id);
      let { activeSpaceId, activeId } = state;
      if (activeSpaceId === id) {
        activeSpaceId = spaces[0]?.id ?? null;
        activeId = tabs.find((t) => t.spaceId === activeSpaceId)?.id ?? null;
      }
      return { spaces, tabs, activeSpaceId, activeId };
    }),

  newTerminalTab: (cwd) => {
    const spaceId = get().ensureSpace();
    const id = nextTabId();
    const paneId = nextPaneId();
    const count = get().tabs.filter((t) => t.kind === "terminal").length + 1;
    const tab: Tab = {
      id,
      spaceId,
      kind: "terminal",
      title: cwd ? basename(cwd) : `Terminal ${count}`,
      paneTree: leaf(paneId, { kind: "terminal" }),
      activeLeafId: paneId,
      cwd,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openSshTab: (connectionId, name) => {
    const spaceId = get().ensureSpace();
    // Re-opening a connection that's already showing in this space focuses that
    // tab instead of spawning a duplicate session (two sessions would race for
    // the same forwarded local port). Matches openLauncherTab's reuse.
    const existing = get().tabs.find(
      (t) =>
        t.spaceId === spaceId &&
        computeLayout(t.paneTree).some(
          (p) =>
            p.content.kind === "terminal" && p.content.ssh?.connectionId === connectionId,
        ),
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "terminal",
      title: name,
      paneTree: leaf(paneId, { kind: "terminal", ssh: { connectionId } }),
      activeLeafId: paneId,
      renamed: true,
    };
    // Mark this leaf as freshly user-opened so TerminalView auto-connects on mount.
    // Restored panes (after app relaunch) never reach this path, so their leaf ids
    // will NOT be in the set and TerminalView will show the Reconnect state instead.
    markFreshSshLeaf(paneId);
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openLauncherTab: () => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find((t) => t.kind === "launcher" && t.spaceId === spaceId);
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "launcher",
      title: "New Tab",
      paneTree: leaf(paneId, { kind: "terminal" }),
      activeLeafId: paneId,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openEditorTab: (path) => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find(
      (t) =>
        t.kind === "editor" &&
        t.spaceId === spaceId &&
        singleLeafContentEquals(t, { kind: "editor", path }),
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "editor",
      title: basename(path),
      paneTree: leaf(paneId, { kind: "editor", path }),
      activeLeafId: paneId,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openNoteTab: (noteId, title) => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find(
      (t) =>
        t.kind === "note" &&
        t.spaceId === spaceId &&
        singleLeafContentEquals(t, { kind: "note", noteId }),
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "note",
      title: title || "Untitled",
      paneTree: leaf(paneId, { kind: "note", noteId }),
      activeLeafId: paneId,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openPreviewTab: (url) => {
    const spaceId = get().ensureSpace();
    const id = nextTabId();
    const paneId = nextPaneId();
    let host = url;
    try {
      host = new URL(url).host || url;
    } catch {
      host = url;
    }
    const tab: Tab = {
      id,
      spaceId,
      kind: "preview",
      title: host,
      paneTree: leaf(paneId, { kind: "preview", url }),
      activeLeafId: paneId,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openGitGraphTab: () => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find(
      (t) =>
        t.kind === "git-graph" &&
        t.spaceId === spaceId &&
        singleLeafContentEquals(t, { kind: "git-graph" }),
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "git-graph",
      title: "Git Graph",
      paneTree: leaf(paneId, { kind: "git-graph" }),
      activeLeafId: paneId,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openLogTab: (logName) => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find((t) => t.kind === "log" && t.spaceId === spaceId);
    if (existing) {
      // Replace the active leaf's content with the new log, update title, and focus.
      // setLeafPane works for both single-leaf and split trees — it replaces in-place
      // anywhere in the tree, so a split layout is preserved (not discarded).
      const newPaneTree = setLeafPane(existing.paneTree, existing.activeLeafId, { kind: "log", logName });
      // activeLeafId stays the same — the active leaf is what we replaced.
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === existing.id ? { ...t, title: logName, paneTree: newPaneTree } : t,
        ),
        activeId: existing.id,
      }));
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "log",
      title: logName,
      paneTree: leaf(paneId, { kind: "log", logName }),
      activeLeafId: paneId,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  setTabTitle: (id, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title, renamed: true } : t)),
    })),

  syncTabTitleToCwd: (id, cwd) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id && t.kind === "terminal" && !t.renamed
          ? { ...t, title: basename(cwd) }
          : t,
      ),
    })),

  closeTab: (id) =>
    set((state) => {
      const closing = state.tabs.find((t) => t.id === id);
      if (!closing) {
        return state;
      }
      const sameSpace = state.tabs.filter((t) => t.spaceId === closing.spaceId);
      const indexInSpace = sameSpace.findIndex((t) => t.id === id);
      const tabs = state.tabs.filter((t) => t.id !== id);
      let activeId = state.activeId;
      if (state.activeId === id) {
        const remaining = sameSpace.filter((t) => t.id !== id);
        activeId = neighbourId(remaining, indexInSpace);
      }
      return { tabs, activeId };
    }),

  closePaneOrTab: () => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === state.activeId);
    if (!tab) {
      return;
    }
    const panes = computeLayout(tab.paneTree);
    if (panes.length <= 1) {
      get().closeTab(tab.id);
      return;
    }
    // Bottom-most wins; ties broken by right-most — so a split peels away from
    // the bottom-right corner, the reverse of how panes are read.
    const target = panes.reduce((a, b) => {
      if (b.rect.top !== a.rect.top) {
        return b.rect.top > a.rect.top ? b : a;
      }
      return b.rect.left > a.rect.left ? b : a;
    });
    get().closePane(tab.id, target.id);
  },

  setActive: (id) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      return tab ? { activeId: id, activeSpaceId: tab.spaceId } : { activeId: id };
    }),

  reorderTab: (activeId, overId) =>
    set((state) => {
      if (activeId === overId) {
        return state;
      }
      const moving = state.tabs.find((t) => t.id === activeId);
      const over = state.tabs.find((t) => t.id === overId);
      if (!moving || !over || moving.spaceId !== over.spaceId) {
        return state;
      }
      // Slots are the indices this space's tabs occupy in the flat array;
      // we reorder only the subsequence and write it back into those slots,
      // so tabs from other spaces never move.
      const slots: number[] = [];
      state.tabs.forEach((tab, index) => {
        if (tab.spaceId === moving.spaceId) {
          slots.push(index);
        }
      });
      const subsequence = slots.map((index) => state.tabs[index]);
      const from = subsequence.findIndex((t) => t.id === activeId);
      const to = subsequence.findIndex((t) => t.id === overId);
      const reordered = moveItem(subsequence, from, to);
      const tabs = state.tabs.slice();
      slots.forEach((slotIndex, k) => {
        tabs[slotIndex] = reordered[k];
      });
      return { tabs };
    }),

  splitActivePane: (direction) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== state.activeId) {
          return tab;
        }
        const newId = nextPaneId();
        return {
          ...tab,
          // A fresh split shows the launcher so the user picks what goes in it.
          paneTree: splitLeaf(tab.paneTree, tab.activeLeafId, direction, newId, {
            kind: "launcher",
          }),
          activeLeafId: newId,
        };
      }),
    })),

  setActiveLeaf: (tabId, leafId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, activeLeafId: leafId } : tab,
      ),
    })),

  focusNextPane: () =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === state.activeId);
      if (!tab) {
        return state;
      }
      // Walk the leaves in their reading order; a single-pane tab has nothing
      // to cycle to.
      const ids = leafIds(tab.paneTree);
      if (ids.length <= 1) {
        return state;
      }
      const current = ids.indexOf(tab.activeLeafId);
      const next = ids[(current + 1) % ids.length];
      return {
        tabs: state.tabs.map((t) =>
          t.id === tab.id ? { ...t, activeLeafId: next } : t,
        ),
      };
    }),

  resizePane: (tabId, splitId, sizes) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, paneTree: setSizesById(tab.paneTree, splitId, sizes) }
          : tab,
      ),
    })),

  splitPaneWith: (tabId, fromLeafId, content, direction) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const newId = nextPaneId();
        return {
          ...tab,
          paneTree: splitLeaf(tab.paneTree, fromLeafId, direction, newId, content),
          activeLeafId: newId,
        };
      }),
    })),

  setPaneContent: (tabId, leafId, content) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, paneTree: setLeafPane(tab.paneTree, leafId, content) }
          : tab,
      ),
    })),

  setTerminalCwd: (tabId, leafId, cwd) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) {
        return state;
      }
      const current = findPaneContent(tab.paneTree, leafId);
      // Only terminal panes carry a cwd; skip a no-op write so persistence is
      // not churned on every snapshot.
      if (!current || current.kind !== "terminal" || current.cwd === cwd) {
        return state;
      }
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                paneTree: setLeafPane(t.paneTree, leafId, {
                  kind: "terminal",
                  cwd,
                  ssh: current.ssh,
                }),
              }
            : t,
        ),
      };
    }),

  closePane: (tabId, leafId) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) {
        return state;
      }
      const paneTree = removeLeaf(tab.paneTree, leafId);
      if (!paneTree) {
        const sameSpace = state.tabs.filter((t) => t.spaceId === tab.spaceId);
        const indexInSpace = sameSpace.findIndex((t) => t.id === tabId);
        const tabs = state.tabs.filter((t) => t.id !== tabId);
        let activeId = state.activeId;
        if (state.activeId === tabId) {
          const remaining = sameSpace.filter((t) => t.id !== tabId);
          activeId = neighbourId(remaining, indexInSpace);
        }
        return { tabs, activeId };
      }
      const activeLeafId =
        tab.activeLeafId === leafId ? (firstLeafId(paneTree) ?? tab.activeLeafId) : tab.activeLeafId;
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, paneTree, activeLeafId } : t,
        ),
      };
    }),
    }),
    {
      name: TABS_STORAGE_KEY,
      storage: createJSONStorage(() => perWindowStorage()),
      version: 1,
      migrate: migratePersistedTabs,
      partialize: (state) => ({
        spaces: state.spaces,
        activeSpaceId: state.activeSpaceId,
        tabs: state.tabs,
        activeId: state.activeId,
      }),
    },
  ),
);
