import { invoke } from "@tauri-apps/api/core";

export interface FileStatus {
  path: string;
  staged: boolean;
  status: string;
}

export interface GitStatus {
  branch: string | null;
  staged: FileStatus[];
  unstaged: FileStatus[];
}

export interface CommitInfo {
  id: string;
  summary: string;
  author: string;
  timestamp: number;
  /** Parent commit hashes, abbreviated to match `id`; used to lay out the sidebar's commit graph. */
  parents: string[];
}

export function gitResolveRepo(path: string): Promise<string | null> {
  return invoke<string | null>("git_resolve_repo", { path });
}

export function gitStatus(repoPath: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { repoPath });
}

export function gitStage(repoPath: string, path: string): Promise<void> {
  return invoke("git_stage", { repoPath, path });
}

export function gitUnstage(repoPath: string, path: string): Promise<void> {
  return invoke("git_unstage", { repoPath, path });
}

export function gitCommit(repoPath: string, message: string): Promise<string> {
  return invoke<string>("git_commit", { repoPath, message });
}

export function gitLog(repoPath: string, limit?: number): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("git_log", { repoPath, limit });
}

/** Commits authored in [sinceMs, untilMs] in the git work tree at `cwd`.
 *  Empty for a non-git / remote / failed cwd. Timestamps are epoch ms. */
export function gitCommitsInRange(cwd: string, sinceMs: number, untilMs: number): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("git_commits_in_range", { cwd, sinceMs, untilMs });
}

export function gitDiff(repoPath: string, staged: boolean): Promise<string> {
  return invoke<string>("git_diff", { repoPath, staged });
}

export function gitPush(repoPath: string): Promise<string> {
  return invoke<string>("git_push", { repoPath });
}

/** rev is "HEAD" (last commit) or ":" (the index). Missing at rev = "". */
export function gitFileAtRev(repoPath: string, rev: "HEAD" | ":", path: string): Promise<string> {
  return invoke<string>("git_file_at_rev", { repoPath, rev, path });
}

/** Discard unstaged changes to one tracked file (git restore). */
export function gitRestoreFile(repoPath: string, path: string): Promise<void> {
  return invoke<void>("git_restore_file", { repoPath, path });
}
