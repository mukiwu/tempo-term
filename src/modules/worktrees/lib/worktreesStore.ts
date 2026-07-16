import { create } from "zustand";
import { gitResolveRepo } from "@/modules/source-control/lib/gitBridge";
import { useWorktreeRegistryStore } from "@/stores/worktreeRegistryStore";
import type { WorktreeAddResult, WorktreeDetail } from "../types";
import {
  gitWorktreeAdd,
  gitWorktreeDiskSize,
  gitWorktreeListDetailed,
  gitWorktreePrune,
  gitWorktreeRemove,
} from "./worktreesBridge";
import { panesInWorktree } from "./removeWorktree";
import { useTabsStore } from "@/stores/tabsStore";

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
  /**
   * Add a worktree for a new branch cut from `base` (HEAD when omitted), then
   * rescan so it is listed and counted without anyone asking. Rejects with
   * git's own message — the caller shows it.
   */
  create: (
    repoPath: string,
    branch: string,
    path: string,
    options?: { base?: string; createBranch?: boolean },
  ) => Promise<WorktreeAddResult>;
  /**
   * Remove a worktree, and optionally the branch it held.
   *
   * `force` discards uncommitted work and is only ever passed for a user who
   * read the count and said so. Every terminal sitting in the worktree is closed
   * first: on Windows a live pty holds a handle on its cwd and the directory
   * cannot be deleted.
   */
  remove: (
    repoPath: string,
    path: string,
    options?: { deleteBranch?: string; forceDeleteBranch?: boolean; force?: boolean },
  ) => Promise<void>;
  /** Drop metadata for worktrees whose directory is gone; returns git's report. */
  prune: (repoPath: string) => Promise<string[]>;
  loadSize: (path: string) => Promise<number>;
  reset: () => void;
}

export const useWorktreesStore = create<WorktreesState>((set, get) => ({
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

  create: async (repoPath, branch, path, options = {}) => {
    // A new branch by default — naming one is the point of the dialog. The
    // git-graph entry point arrives with a branch that already exists and asks
    // for it to be checked out here instead.
    const createBranch = options.createBranch ?? true;
    const result = await gitWorktreeAdd(repoPath, path, branch, createBranch, options.base);
    // Only after it worked. A failed add leaves nothing new to find, and the
    // rescan would just cost a subprocess to learn that.
    try {
      await get().refresh(repoPath);
    } catch {
      // The worktree is on disk either way. A scan that lost a race with a git
      // lock must not report the creation as failed: the user would be told it
      // did not happen, and their retry would then die on "branch already
      // exists". The list catches up on the next scan; the lie would not.
    }
    return result;
  },

  remove: async (repoPath, path, options = {}) => {
    // Before git touches the directory, not after. A pty rooted in it holds the
    // directory open on Windows, and the removal would fail halfway — leaving
    // git's metadata pointing at a directory that is half gone.
    const tabs = useTabsStore.getState();
    for (const pane of panesInWorktree(tabs.tabs, path)) {
      tabs.closePane(pane.tabId, pane.leafId);
    }

    await gitWorktreeRemove(
      repoPath,
      path,
      options.deleteBranch,
      options.forceDeleteBranch ?? false,
      options.force ?? false,
    );

    set((state) => {
      if (!(path in state.sizes)) {
        return state;
      }
      const sizes = { ...state.sizes };
      delete sizes[path];
      return { sizes };
    });

    try {
      await get().refresh(repoPath);
    } catch {
      // Gone is gone. A scan that lost a race with a git lock must not report a
      // completed removal as failed — the same trap as create.
    }
  },

  prune: async (repoPath) => {
    const pruned = await gitWorktreePrune(repoPath);
    try {
      await get().refresh(repoPath);
    } catch {
      // As above: the prune happened whatever the rescan says.
    }
    return pruned;
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
