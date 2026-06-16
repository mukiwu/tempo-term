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
