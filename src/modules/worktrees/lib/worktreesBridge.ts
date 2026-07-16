import { invoke } from "@tauri-apps/api/core";
import type { WorktreeAddResult, WorktreeDetail } from "../types";

/**
 * Every worktree of the repo, including the bare/locked/prunable entries the
 * plain `gitWorktreeList` drops. Spawns one `git worktree list --porcelain`
 * (~10-30ms, more on Windows), so callers cache the result and refresh on
 * events rather than polling.
 */
export function gitWorktreeListDetailed(path: string): Promise<WorktreeDetail[]> {
  return invoke<WorktreeDetail[]>("git_worktree_list_detailed", { path });
}

/**
 * Add a worktree. With `createBranch` the branch is created from `base` (HEAD
 * when omitted); otherwise an existing branch is checked out there. `path` must
 * be absolute — git resolves a relative one against the repo, the pre-flight
 * against the app's cwd.
 */
export function gitWorktreeAdd(
  repoPath: string,
  path: string,
  branch: string,
  createBranch: boolean,
  base?: string,
): Promise<WorktreeAddResult> {
  return invoke<WorktreeAddResult>("git_worktree_add", {
    repoPath,
    path,
    branch,
    createBranch,
    base,
  });
}

/**
 * Remove a worktree, and optionally the branch it had checked out. Never forces:
 * git refuses a dirty worktree, which is the last safety net behind the UI's own
 * block. Close the worktree's tab and kill its ptys first — on Windows a live
 * pty holds a handle on its cwd and the directory cannot be deleted.
 */
export function gitWorktreeRemove(
  repoPath: string,
  path: string,
  deleteBranch?: string,
  forceDeleteBranch = false,
): Promise<void> {
  return invoke("git_worktree_remove", { repoPath, path, deleteBranch, forceDeleteBranch });
}

/** Drop metadata for worktrees whose directory is gone; returns what git removed. */
export function gitWorktreePrune(path: string): Promise<string[]> {
  return invoke<string[]>("git_worktree_prune", { path });
}

/** Modified + untracked file count, for a row's dirty dot. */
export function gitWorktreeDirtyCount(path: string): Promise<number> {
  return invoke<number>("git_worktree_dirty_count", { path });
}

/**
 * Total bytes of the checkout (git's own `.git` storage excluded). Expensive —
 * a worktree that has had `pnpm install` run in it is tens of thousands of
 * files. Call lazily, one row at a time, never on open and never for a tooltip.
 */
export function gitWorktreeDiskSize(path: string): Promise<number> {
  return invoke<number>("git_worktree_disk_size", { path });
}
