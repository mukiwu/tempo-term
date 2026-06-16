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
 * Terax-style typed tabs. Each tab is an independent panel of a chosen kind.
 * Terminal tabs own a recursive split paneTree; editor tabs hold one file.
 * Tabs stay mounted when inactive (hidden), so terminals keep running.
 */
export interface TerminalTab {
  id: string;
  kind: "terminal";
  title: string;
  paneTree: LayoutNode;
  activeLeafId: string;
  /** Directory new panes in this tab start in (the work-tree root at creation). */
  cwd?: string;
}

export interface EditorTab {
  id: string;
  kind: "editor";
  title: string;
  path: string;
}

export type Tab = TerminalTab | EditorTab;

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  newTerminalTab: (cwd?: string) => string;
  openEditorTab: (path: string) => string;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  splitActivePane: (direction: SplitDirection) => void;
  setActiveLeaf: (tabId: string, leafId: string) => void;
  closePane: (tabId: string, leafId: string) => void;
}

let tabCounter = 0;
let paneCounter = 0;
function nextTabId(): string {
  tabCounter += 1;
  return `tab-${tabCounter}`;
}
function nextPaneId(): string {
  paneCounter += 1;
  return `pane-${paneCounter}`;
}

function basename(path: string): string {
  const seg = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return seg && seg.length > 0 ? seg : path;
}

function neighbourId(tabs: Tab[], index: number): string | null {
  return tabs[index - 1]?.id ?? tabs[index]?.id ?? null;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,

  newTerminalTab: (cwd) => {
    const id = nextTabId();
    const paneId = nextPaneId();
    const count = get().tabs.filter((t) => t.kind === "terminal").length + 1;
    const tab: TerminalTab = {
      id,
      kind: "terminal",
      title: `Terminal ${count}`,
      paneTree: leaf(paneId),
      activeLeafId: paneId,
      cwd,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openEditorTab: (path) => {
    const existing = get().tabs.find((t) => t.kind === "editor" && t.path === path);
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const tab: EditorTab = { id, kind: "editor", title: basename(path), path };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  closeTab: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) {
        return state;
      }
      const tabs = state.tabs.filter((t) => t.id !== id);
      const activeId =
        state.activeId === id ? neighbourId(tabs, index) : state.activeId;
      return { tabs, activeId };
    }),

  setActive: (id) => set({ activeId: id }),

  splitActivePane: (direction) =>
    set((state) => {
      const tabs = state.tabs.map((tab) => {
        if (tab.id !== state.activeId || tab.kind !== "terminal") {
          return tab;
        }
        const newId = nextPaneId();
        return {
          ...tab,
          paneTree: splitLeaf(tab.paneTree, tab.activeLeafId, direction, newId),
          activeLeafId: newId,
        };
      });
      return { tabs };
    }),

  setActiveLeaf: (tabId, leafId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId && tab.kind === "terminal"
          ? { ...tab, activeLeafId: leafId }
          : tab,
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
        // Last pane closed: close the whole tab.
        const index = state.tabs.findIndex((t) => t.id === tabId);
        const tabs = state.tabs.filter((t) => t.id !== tabId);
        const activeId =
          state.activeId === tabId ? neighbourId(tabs, index) : state.activeId;
        return { tabs, activeId };
      }
      const activeLeafId =
        tab.activeLeafId === leafId
          ? (firstLeafId(paneTree) ?? tab.activeLeafId)
          : tab.activeLeafId;
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId && t.kind === "terminal" ? { ...t, paneTree, activeLeafId } : t,
        ),
      };
    }),
}));
