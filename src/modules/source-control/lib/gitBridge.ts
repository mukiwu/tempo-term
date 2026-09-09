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

/** A ref the all-changes page can be compared against. */
export interface ComparisonBase {
  /** Short ref name, e.g. `upstream/main`, `origin/feat/x`, `master`. */
  name: string;
  /** Why it is on offer: a remote's default branch, this branch's tracking
   * branch, or a local mainline. */
  kind: "remoteDefault" | "upstream" | "localDefault";
  /** Committer time of the tip, Unix seconds; 0 when it could not be read. */
  lastCommitAt: number;
}

export interface ComparisonBases {
  bases: ComparisonBase[];
  /** The first of them, or null when the repo offers nothing worth guessing. */
  suggested: string | null;
}

export function gitResolveRepo(path: string): Promise<string | null> {
  return invoke<string | null>("git_resolve_repo", { path });
}

export function gitStatus(repoPath: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { repoPath });
}

/**
 * The refs worth comparing against, and which one to suggest. The fallback
 * order lives in the command, so there is one copy of it rather than one here
 * and one in Rust drifting apart.
 */
export function gitComparisonBases(repoPath: string): Promise<ComparisonBases> {
  return invoke<ComparisonBases>("git_comparison_bases", { repoPath });
}

export interface TagInfo {
  name: string;
  /** Annotated tags carry their own date; lightweight ones borrow the commit's. */
  lastCommitAt: number;
}

/**
 * Every tag. The base picker offers names, and a tag is one — "what changed
 * since the last release" gets asked more than once. Git Graph only ever saw
 * the tags decorating the commits it had loaded, which is not the same list.
 */
export function gitTags(repoPath: string): Promise<TagInfo[]> {
  return invoke<TagInfo[]>("git_tags", { repoPath });
}

/**
 * `rev` as a commit sha, or null when it names nothing. Null is the answer,
 * not a failure: this exists to ask the question before acting on it.
 */
export function gitResolveRev(repoPath: string, rev: string): Promise<string | null> {
  return invoke<string | null>("git_resolve_rev", { repoPath, rev });
}

export interface BaseDiff {
  /** The resolved starting point. Every file's left-hand document is read at
   * this sha, so it must be the one the diff below was taken from. */
  rev: string;
  /** `git diff <rev>`: everything between that point and the working tree. */
  diff: string;
}

/**
 * One comparison between `base` and the working tree, committed and
 * uncommitted work together — what #398 settled on instead of stitching two
 * halves. `mergeBase` (the default) starts from where the two diverged, so
 * commits the base gained since are not counted as yours.
 */
export function gitDiffFromBase(
  repoPath: string,
  base: string,
  mergeBase = true,
  /** False stops at the last commit instead of the working tree: what the
   * branch changed, without whatever is still being edited. */
  includeUncommitted = true,
  /** The far end. Left out it is the working tree; naming a commit makes this
   * a comparison between two points, where neither end is on disk. */
  to?: string,
): Promise<BaseDiff> {
  return invoke<BaseDiff>("git_diff_from_base", {
    repoPath,
    base,
    mergeBase,
    includeUncommitted,
    to,
  });
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

/**
 * A file as of `rev`. "HEAD" is the last commit and ":" is the index; any
 * other rev -- a branch, a tag, a hash -- is resolved by the command, which
 * refuses one it cannot resolve rather than handing it to git's argv.
 *
 * Missing at that rev is an empty document, not an error.
 */
export function gitFileAtRev(repoPath: string, rev: string, path: string): Promise<string> {
  return invoke<string>("git_file_at_rev", { repoPath, rev, path });
}

/** Discard unstaged changes to one tracked file (git restore). */
export function gitRestoreFile(repoPath: string, path: string): Promise<void> {
  return invoke<void>("git_restore_file", { repoPath, path });
}
