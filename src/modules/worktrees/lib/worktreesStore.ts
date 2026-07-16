import { create } from "zustand";
import { gitResolveRepo } from "@/modules/source-control/lib/gitBridge";
import { useWorktreeRegistryStore } from "@/stores/worktreeRegistryStore";
import type { WorktreeDetail } from "../types";
import { gitWorktreeDiskSize, gitWorktreeListDetailed } from "./worktreesBridge";

/**
 * Whether `repoPath` is still a git repository — the non-brittle signal for
 * "this entry is genuinely gone", as opposed to matching git's stderr, which is
 * localized and would misfire in any non-English shell.
 *
 * Defaults to `true` if the probe itself fails: never forget a repo on a guess.
 */
async function stillARepo(repoPath: string): Promise<boolean> {
  try {
    return (await gitResolveRepo(repoPath)) !== null;
  } catch {
    return true;
  }
}

/**
 * In-flight scans and size walks, keyed by path. Module-level rather than in the
 * store because they are not state anyone renders — they exist so two rows
 * mounting at once cannot fire the same subprocess twice.
 */
const scansInFlight = new Map<string, Promise<WorktreeDetail[]>>();
const sizesInFlight = new Map<string, Promise<number>>();

interface WorktreesState {
  /** Cached scan per repo main path. Never recomputed to render — refreshed on
   *  events only (open, create, remove, manual), never on a timer. */
  byRepo: Record<string, WorktreeDetail[]>;
  /** Lazily measured bytes per worktree path; absent until asked for. */
  sizes: Record<string, number>;
  refresh: (repoPath: string) => Promise<WorktreeDetail[]>;
  loadSize: (path: string) => Promise<number>;
  reset: () => void;
}

export const useWorktreesStore = create<WorktreesState>((set) => ({
  byRepo: {},
  sizes: {},

  refresh: (repoPath) => {
    const existing = scansInFlight.get(repoPath);
    if (existing) {
      return existing;
    }
    const scan = gitWorktreeListDetailed(repoPath)
      .then((details) => {
        set((state) => ({ byRepo: { ...state.byRepo, [repoPath]: details } }));
        // The scan is where we learn whether this repo is worth remembering:
        // the registry holds only repos that actually have linked worktrees.
        const linked = details.filter((detail) => !detail.isMain).length;
        useWorktreeRegistryStore.getState().record(repoPath, linked);
        return details;
      })
      .catch(async (error: unknown) => {
        // A failed scan is not proof the repo is gone — a git lock or a spawn
        // hiccup fails the same way. Ask for the real signal before dropping
        // anything, because the two mistakes are not equal: silently forgetting
        // a live repo under-counts the badge invisibly, while keeping a stale
        // one is visible in the manager and can be forgotten from there.
        if (await stillARepo(repoPath)) {
          throw error;
        }
        useWorktreeRegistryStore.getState().forget(repoPath);
        set((state) => {
          if (!(repoPath in state.byRepo)) {
            return state;
          }
          const byRepo = { ...state.byRepo };
          delete byRepo[repoPath];
          return { byRepo };
        });
        throw error;
      })
      .finally(() => {
        scansInFlight.delete(repoPath);
      });
    scansInFlight.set(repoPath, scan);
    return scan;
  },

  loadSize: (path) => {
    const existing = sizesInFlight.get(path);
    if (existing) {
      return existing;
    }
    const walk = gitWorktreeDiskSize(path)
      .then((bytes) => {
        set((state) => ({ sizes: { ...state.sizes, [path]: bytes } }));
        return bytes;
      })
      .finally(() => {
        sizesInFlight.delete(path);
      });
    sizesInFlight.set(path, walk);
    return walk;
  },

  reset: () => {
    scansInFlight.clear();
    sizesInFlight.clear();
    set({ byRepo: {}, sizes: {} });
  },
}));
