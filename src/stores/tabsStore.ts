import { create } from "zustand";
import {
  firstLeafId,
  leaf,
  removeLeaf,
  splitLeaf,
  type LayoutNode,
  type SplitDirection,
} from "@/modules/terminal/lib/terminalLayout";

/**
 * Terax-style typed tabs grouped into spaces. A space is a context (like a
 * window) that holds its own set of tabs. Each tab is an independent panel of a
 * chosen kind: terminal tabs own a recursive split paneTree; editor tabs hold
 * one file. Tabs stay mounted when inactive (hidden) so terminals keep running.
 */
export interface Space {
  id: string;
  name: string;
}

interface TabBase {
  id: string;
  spaceId: string;
  title: string;
}

export interface TerminalTab extends TabBase {
  kind: "terminal";
  paneTree: LayoutNode;
  activeLeafId: string;
  /** Directory new panes in this tab start in (the work-tree root at creation). */
  cwd?: string;
}

export interface EditorTab extends TabBase {
  kind: "editor";
  path: string;
}

export interface NoteTab extends TabBase {
  kind: "note";
  noteId: string;
}

export interface PreviewTab extends TabBase {
  kind: "preview";
  url: string;
}

export interface GitGraphTab extends TabBase {
  kind: "git-graph";
}

export type Tab = TerminalTab | EditorTab | NoteTab | PreviewTab | GitGraphTab;

interface TabsState {
  spaces: Space[];
  activeSpaceId: string | null;
  tabs: Tab[];
  activeId: string | null;
  ensureSpace: () => string;
  newSpace: (name?: string) => string;
  setActiveSpace: (id: string) => void;
  newTerminalTab: (cwd?: string) => string;
  openEditorTab: (path: string) => string;
  openNoteTab: (noteId: string, title: string) => string;
  openPreviewTab: (url: string) => string;
  openGitGraphTab: () => string;
  setTabTitle: (id: string, title: string) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  splitActivePane: (direction: SplitDirection) => void;
  setActiveLeaf: (tabId: string, leafId: string) => void;
  closePane: (tabId: string, leafId: string) => void;
}

let tabCounter = 0;
let paneCounter = 0;
let spaceCounter = 0;
function nextTabId(): string {
  tabCounter += 1;
  return `tab-${tabCounter}`;
}
function nextPaneId(): string {
  paneCounter += 1;
  return `pane-${paneCounter}`;
}
function nextSpaceId(): string {
  spaceCounter += 1;
  return `space-${spaceCounter}`;
}

function basename(path: string): string {
  const seg = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return seg && seg.length > 0 ? seg : path;
}

function neighbourId(tabs: Tab[], index: number): string | null {
  return tabs[index - 1]?.id ?? tabs[index]?.id ?? null;
}

export const useTabsStore = create<TabsState>((set, get) => ({
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

  newTerminalTab: (cwd) => {
    const spaceId = get().ensureSpace();
    const id = nextTabId();
    const paneId = nextPaneId();
    const count = get().tabs.filter((t) => t.kind === "terminal").length + 1;
    const tab: TerminalTab = {
      id,
      spaceId,
      kind: "terminal",
      title: cwd ? basename(cwd) : `Terminal ${count}`,
      paneTree: leaf(paneId),
      activeLeafId: paneId,
      cwd,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openEditorTab: (path) => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find(
      (t) => t.kind === "editor" && t.path === path && t.spaceId === spaceId,
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const tab: EditorTab = { id, spaceId, kind: "editor", title: basename(path), path };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openNoteTab: (noteId, title) => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find(
      (t) => t.kind === "note" && t.noteId === noteId && t.spaceId === spaceId,
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const tab: NoteTab = { id, spaceId, kind: "note", title: title || "Untitled", noteId };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openPreviewTab: (url) => {
    const spaceId = get().ensureSpace();
    const id = nextTabId();
    let host = url;
    try {
      host = new URL(url).host || url;
    } catch {
      host = url;
    }
    const tab: PreviewTab = { id, spaceId, kind: "preview", title: host, url };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openGitGraphTab: () => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find(
      (t) => t.kind === "git-graph" && t.spaceId === spaceId,
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const tab: GitGraphTab = { id, spaceId, kind: "git-graph", title: "Git Graph" };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  setTabTitle: (id, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
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

  setActive: (id) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      return tab ? { activeId: id, activeSpaceId: tab.spaceId } : { activeId: id };
    }),

  splitActivePane: (direction) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== state.activeId || tab.kind !== "terminal") {
          return tab;
        }
        const newId = nextPaneId();
        return {
          ...tab,
          paneTree: splitLeaf(tab.paneTree, tab.activeLeafId, direction, newId),
          activeLeafId: newId,
        };
      }),
    })),

  setActiveLeaf: (tabId, leafId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId && tab.kind === "terminal" ? { ...tab, activeLeafId: leafId } : tab,
      ),
    })),

  closePane: (tabId, leafId) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab || tab.kind !== "terminal") {
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
          t.id === tabId && t.kind === "terminal" ? { ...t, paneTree, activeLeafId } : t,
        ),
      };
    }),
}));
