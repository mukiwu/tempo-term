import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AgentKind } from "@/modules/claude-progress/lib/codexNormalize";

/**
 * Gitignored files worth carrying into a fresh worktree. `git worktree add`
 * gives you tracked source only, so without this an agent's first command dies
 * on a missing `.env` — the exact failure this feature exists to avoid. The glob
 * is recursive because a monorepo keeps them at `packages/*\/.env`.
 */
export const DEFAULT_COPY_GLOBS = ["**/.env*"];

export interface WorktreeRepoSettings {
  /** Overrides the default `<repo>-worktrees` sibling container. */
  containerPath?: string;
  /** Run inside the new worktree right after it is created, e.g. `pnpm install`. */
  setupCommand?: string;
  /** Local files to copy in. Defaults to {@link DEFAULT_COPY_GLOBS}. */
  copyGlobs?: string[];
  /** Pre-selects the agent picker next time. */
  lastAgent?: AgentKind;
}

const STORAGE_KEY = "tempoterm-worktree-settings";

interface WorktreeSettingsState {
  /** Keyed by the repo's **main** worktree path, so every linked worktree of a
   *  repo shares one setup command. */
  byRepo: Record<string, WorktreeRepoSettings>;
  repoSettings: (repoPath: string) => WorktreeRepoSettings;
  setRepoSettings: (repoPath: string, patch: Partial<WorktreeRepoSettings>) => void;
  forgetRepo: (repoPath: string) => void;
}

const EMPTY: WorktreeRepoSettings = {};

export const useWorktreeSettingsStore = create<WorktreeSettingsState>()(
  persist(
    (set, get) => ({
      byRepo: {},

      repoSettings: (repoPath) => get().byRepo[repoPath] ?? EMPTY,

      setRepoSettings: (repoPath, patch) =>
        set((state) => ({
          byRepo: {
            ...state.byRepo,
            [repoPath]: { ...(state.byRepo[repoPath] ?? {}), ...patch },
          },
        })),

      forgetRepo: (repoPath) =>
        set((state) => {
          if (!(repoPath in state.byRepo)) {
            return state;
          }
          const byRepo = { ...state.byRepo };
          delete byRepo[repoPath];
          return { byRepo };
        }),
    }),
    {
      // Global, not per-window: a repo's setup command is a property of the
      // repo, not of whichever window happens to be open (settingsStore is the
      // precedent; workspaceStore's per-window storage would be wrong here).
      name: STORAGE_KEY,
      partialize: (state) => ({ byRepo: state.byRepo }),
    },
  ),
);
