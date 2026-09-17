import { create } from "zustand";

interface GraphSearchRequestState {
  /** Bumped by each request; the toolbar acts on the change, not the value. */
  token: number;
  /** Ask the Git Graph toolbar to open its search box and take the caret. */
  open: () => void;
}

/**
 * Carries the Ctrl/Cmd+F shortcut from the window-level keydown handler to the
 * Git Graph toolbar, which owns whether its search box is open. A counter
 * rather than a boolean: pressing the shortcut again while the box is already
 * open has to be a fresh request (it selects what is in there), and a flag
 * that is already true says nothing happened.
 */
export const useGraphSearchRequestStore = create<GraphSearchRequestState>((set) => ({
  token: 0,
  open: () => set((s) => ({ token: s.token + 1 })),
}));
