import { invoke } from "@tauri-apps/api/core";
import type { Branch, GraphLog } from "../types";

/** Read the commit DAG (all branches) for the graph view. */
export function gitGraphLog(
  repoPath: string,
  limit?: number,
  skip?: number,
): Promise<GraphLog> {
  return invoke<GraphLog>("git_graph_log", { repoPath, limit, skip });
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
