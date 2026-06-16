import { create } from "zustand";

export interface TerminalTab {
  id: string;
  title: string;
}

interface TerminalTabsState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  addTab: () => string;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  renameTab: (id: string, title: string) => void;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `term-${counter}`;
}

export const useTerminalTabsStore = create<TerminalTabsState>((set) => ({
  tabs: [],
  activeTabId: null,

  addTab: () => {
    const id = nextId();
    set((state) => ({
      tabs: [...state.tabs, { id, title: `Shell ${state.tabs.length + 1}` }],
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

  renameTab: (id, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    })),
}));
