import { create } from "zustand";
import { gitWorktreeInfo, type WorktreeInfo } from "./worktreeBridge";

interface WorktreeStoreState {
  /** Branch/worktree context per directory (keyed by cwd). */
  infos: Record<string, WorktreeInfo>;
  setInfo: (cwd: string, info: WorktreeInfo) => void;
  /** Fetch and cache worktree info for each cwd; failures are ignored. */
  refresh: (cwds: string[]) => Promise<void>;
}

export const useWorktreeStore = create<WorktreeStoreState>((set) => ({
  infos: {},

  setInfo: (cwd, info) =>
    set((state) => ({ infos: { ...state.infos, [cwd]: info } })),

  refresh: async (cwds) => {
    await Promise.all(
      cwds.map(async (cwd) => {
        try {
          const info = await gitWorktreeInfo(cwd);
          set((state) => ({ infos: { ...state.infos, [cwd]: info } }));
        } catch {
          // A directory may not be a git repo, or the backend may be absent in
          // tests/web preview; leave any previous value untouched.
        }
      }),
    );
  },
}));
