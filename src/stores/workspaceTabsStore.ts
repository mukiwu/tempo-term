import { create } from "zustand";

export interface WorkspaceTab {
  id: string;
  rootPath: string;
  name: string;
}

interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  /** Open a folder as a workspace tab (or re-activate it if already open). */
  openWorkspace: (rootPath: string) => string;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  activeRootPath: () => string | null;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `ws-${counter}`;
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const segment = trimmed.split(/[\\/]/).pop();
  return segment && segment.length > 0 ? segment : trimmed;
}

export const useWorkspaceTabsStore = create<WorkspaceTabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openWorkspace: (rootPath) => {
    const existing = get().tabs.find((t) => t.rootPath === rootPath);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = nextId();
    set((state) => ({
      tabs: [...state.tabs, { id, rootPath, name: basename(rootPath) }],
      activeTabId: id,
    }));
    return id;
  },

  closeTab: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) {
        return state;
      }
      const tabs = state.tabs.filter((t) => t.id !== id);
      let activeTabId = state.activeTabId;
      if (state.activeTabId === id) {
        const neighbour = tabs[index - 1] ?? tabs[index] ?? null;
        activeTabId = neighbour ? neighbour.id : null;
      }
      return { tabs, activeTabId };
    }),

  setActive: (id) => set({ activeTabId: id }),

  activeRootPath: () => {
    const { tabs, activeTabId } = get();
    return tabs.find((t) => t.id === activeTabId)?.rootPath ?? null;
  },
}));
