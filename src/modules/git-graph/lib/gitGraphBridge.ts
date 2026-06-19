import { invoke } from "@tauri-apps/api/core";
import type { Branch, CommitDetails, GraphLog, GraphOptions } from "../types";

/** Read the commit DAG for the graph view, filtered by display options. */
export function gitGraphLog(
  repoPath: string,
  limit: number,
  options: GraphOptions,
  skip?: number,
): Promise<GraphLog> {
  return invoke<GraphLog>("git_graph_log", { repoPath, limit, skip, options });
}

/** List local branches, marking the current one. */
export function gitBranches(repoPath: string): Promise<Branch[]> {
  return invoke<Branch[]>("git_branches", { repoPath });
}

/** Check out an existing branch. */
export function gitBranchCheckout(repoPath: string, name: string): Promise<void> {
  return invoke("git_branch_checkout", { repoPath, name });
}

/** Create a branch at `commit` and switch to it. */
export function gitBranchCreateAt(
  repoPath: string,
  name: string,
  commit: string,
): Promise<void> {
  return invoke("git_branch_create_at", { repoPath, name, commit });
}

/** Delete a local branch (`force` allows deleting unmerged branches). */
export function gitBranchDelete(
  repoPath: string,
  name: string,
  force?: boolean,
): Promise<void> {
  return invoke("git_branch_delete", { repoPath, name, force });
}

/** Create a tag at `commit`; a non-empty `message` makes it annotated. */
export function gitTagCreate(
  repoPath: string,
  name: string,
  commit: string,
  message?: string,
): Promise<void> {
  return invoke("git_tag_create", { repoPath, name, commit, message });
}

/** Delete a tag. */
export function gitTagDelete(repoPath: string, name: string): Promise<void> {
  return invoke("git_tag_delete", { repoPath, name });
}

/** Merge `name` into the current branch. */
export function gitMerge(repoPath: string, name: string): Promise<void> {
  return invoke("git_merge", { repoPath, name });
}

/** Revert `commit` with a new commit. */
export function gitRevert(repoPath: string, commit: string): Promise<void> {
  return invoke("git_revert", { repoPath, commit });
}

/** Fetch all remotes and prune deleted remote branches. */
export function gitFetch(repoPath: string): Promise<void> {
  return invoke("git_fetch", { repoPath });
}

/** Cherry-pick `commit` onto the current branch. */
export function gitCherryPick(repoPath: string, commit: string): Promise<void> {
  return invoke("git_cherry_pick", { repoPath, commit });
}

/** Reset the current branch to `commit` (`mode` is "soft" or "hard"). */
export function gitReset(
  repoPath: string,
  commit: string,
  mode?: "soft" | "hard",
): Promise<void> {
  return invoke("git_reset", { repoPath, commit, mode });
}

/** Rebase the current branch onto `commit`. */
export function gitRebase(repoPath: string, commit: string): Promise<void> {
  return invoke("git_rebase", { repoPath, commit });
}

/** Create a local branch `local` tracking `remoteRef` (e.g. "origin/x") and switch to it. */
export function gitBranchCheckoutTrack(
  repoPath: string,
  local: string,
  remoteRef: string,
): Promise<void> {
  return invoke("git_branch_checkout_track", { repoPath, local, remoteRef });
}

/** Pull `branch` from `remote` into the current branch. */
export function gitPull(repoPath: string, remote: string, branch: string): Promise<void> {
  return invoke("git_pull", { repoPath, remote, branch });
}

/** Delete `branch` on `remote`. */
export function gitPushDelete(repoPath: string, remote: string, branch: string): Promise<void> {
  return invoke("git_push_delete", { repoPath, remote, branch });
}

/** Read a commit's full message and changed files. */
export function gitCommitDetails(repoPath: string, commit: string): Promise<CommitDetails> {
  return invoke<CommitDetails>("git_commit_details", { repoPath, commit });
}

/** Read a single file's diff within a commit (against its first parent). */
export function gitCommitFileDiff(
  repoPath: string,
  commit: string,
  file: string,
): Promise<string> {
  return invoke<string>("git_commit_file_diff", { repoPath, commit, file });
}
