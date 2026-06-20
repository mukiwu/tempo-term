import { invoke } from "@tauri-apps/api/core";

/**
 * Branch and worktree context for a directory, mirroring the backend
 * `WorktreeInfo`. For a linked worktree, `mainBranch`/`mainPath` describe the
 * primary working tree so a card can show both lines.
 */
export interface WorktreeInfo {
  branch: string | null;
  cwd: string;
  isWorktree: boolean;
  mainBranch: string | null;
  mainPath: string | null;
}

export function gitWorktreeInfo(path: string): Promise<WorktreeInfo> {
  return invoke<WorktreeInfo>("git_worktree_info", { path });
}
