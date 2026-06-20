import { create } from "zustand";
import { claudeSessionTitle } from "./titlesBridge";

interface TitlesStoreState {
  /** Auto session title per directory (keyed by cwd). */
  titles: Record<string, string>;
  /** Fetch and cache the title for a cwd; a missing title or error is ignored. */
  refresh: (cwd: string) => Promise<void>;
}

export const useTitlesStore = create<TitlesStoreState>((set) => ({
  titles: {},

  refresh: async (cwd) => {
    try {
      const title = await claudeSessionTitle(cwd);
      if (title) {
        set((state) => ({ titles: { ...state.titles, [cwd]: title } }));
      }
    } catch {
      // No transcript yet, or no backend in tests/web preview; keep last value.
    }
  },
}));
