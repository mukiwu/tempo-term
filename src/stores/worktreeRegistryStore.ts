import { create } from "zustand";
import { persist } from "zustand/middleware";

/** A repo known to have worktrees, with its last counted total. */
export interface WorktreeRepoEntry {
  /** The repo's canonical **main** worktree path. */
  repoPath: string;
  /** Linked worktrees only — the main checkout is not one the user made. */
  worktreeCount: number;
  lastScannedAt: number;
}

const STORAGE_KEY = "tempoterm-worktree-repos";

interface WorktreeRegistryState {
  byRepo: Record<string, WorktreeRepoEntry>;
  /**
   * Record what a scan found. A repo enters the registry only once it actually
   * has a linked worktree, and leaves again when its last one goes — which is
   * what keeps this list proportional to what the user really uses instead of
   * growing to every repo they ever opened a terminal in.
   */
  record: (repoPath: string, worktreeCount: number, now?: number) => void;
  /** Drop a repo: its path stopped resolving, or the user asked to forget it. */
  forget: (repoPath: string) => void;
  entries: () => WorktreeRepoEntry[];
}

/** Total linked worktrees across every known repo — the status-bar badge count. */
export const selectTotalWorktrees = (state: WorktreeRegistryState): number =>
  Object.values(state.byRepo).reduce((sum, entry) => sum + entry.worktreeCount, 0);

export const useWorktreeRegistryStore = create<WorktreeRegistryState>()(
  persist(
    (set, get) => ({
      byRepo: {},

      record: (repoPath, worktreeCount, now = Date.now()) =>
        set((state) => {
          if (worktreeCount <= 0) {
            if (!(repoPath in state.byRepo)) {
              return state;
            }
            const byRepo = { ...state.byRepo };
            delete byRepo[repoPath];
            return { byRepo };
          }
          const previous = state.byRepo[repoPath];
          if (previous?.worktreeCount === worktreeCount) {
            // Same count: skip the write so subscribers do not churn on every
            // rescan of an unchanged repo.
            return state;
          }
          return {
            byRepo: {
              ...state.byRepo,
              [repoPath]: { repoPath, worktreeCount, lastScannedAt: now },
            },
          };
        }),

      forget: (repoPath) =>
        set((state) => {
          if (!(repoPath in state.byRepo)) {
            return state;
          }
          const byRepo = { ...state.byRepo };
          delete byRepo[repoPath];
          return { byRepo };
        }),

      entries: () => Object.values(get().byRepo),
    }),
    {
      // Global: "how many worktrees am I keeping around" is a property of the
      // machine, so every window agrees on the badge.
      name: STORAGE_KEY,
      partialize: (state) => ({ byRepo: state.byRepo }),
    },
  ),
);
