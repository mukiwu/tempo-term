/**
 * One worktree as `git worktree list --porcelain` reports it. Mirrors the Rust
 * `WorktreeDetail` in `src-tauri/src/modules/git/mod.rs`.
 *
 * Unlike the plain worktree list this keeps the entries that cannot be switched
 * to: `prunable` (the directory is gone) has to be visible for the user to prune
 * it, and `locked` has to be visible to explain why removal is refused.
 */
export interface WorktreeDetail {
  path: string;
  branch: string | null;
  head: string | null;
  /** Git always reports the repo's primary working tree first. */
  isMain: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
}

/** The worktree a successful add produced; `path` is canonical. */
export interface WorktreeAddResult {
  path: string;
  branch: string;
}
