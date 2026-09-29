import { create } from "zustand";

interface GraphSearchRequestState {
  /** Bumped by each request; the toolbar acts on the change, not the value. */
  token: number;
  /** The pane the request is for, by leaf id. */
  leafId: string | null;
  /** Ask the Git Graph toolbar in `leafId` to open its search box and take the caret. */
  open: (leafId: string) => void;
}

/**
 * Carries the Ctrl/Cmd+F shortcut from the window-level keydown handler to the
 * Git Graph toolbar, which owns whether its search box is open. A counter
 * rather than a boolean: pressing the shortcut again while the box is already
 * open has to be a fresh request (it selects what is in there), and a flag
 * that is already true says nothing happened.
 *
 * Every mounted graph subscribes — a split can show two, and a tab stays
 * mounted once visited — so the request names the pane it is for, and every
 * other toolbar lets it pass.
 */
export const useGraphSearchRequestStore = create<GraphSearchRequestState>((set) => ({
  token: 0,
  leafId: null,
  open: (leafId) => set((s) => ({ token: s.token + 1, leafId })),
}));
