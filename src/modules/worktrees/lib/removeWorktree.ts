import { IS_WINDOWS } from "@/lib/platform";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import type { Tab } from "@/stores/tabsStore";
import { localTerminalCwd } from "./panes";
import { isUnder } from "./paths";
import type { OpenWorktreePane } from "./openWorktree";

/** Why a worktree cannot simply be removed. */
export type RemovalBlocker =
  /** It is the repo's own working tree. Not a confirmation away — never. */
  | "main"
  /** Someone locked it, with a reason worth reading before overriding. */
  | "locked"
  /** It holds work that removal would destroy, and nothing else has a copy. */
  | "dirty";

/**
 * What stands between this worktree and removal, or null when nothing does.
 *
 * The order matters: `main` cannot be got past at all, `locked` is a decision
 * someone already made deliberately, and `dirty` is the one a confirmation can
 * clear. Reporting the mildest of several would understate the problem.
 */
export function removalBlocker(state: {
  /** Modified + untracked files, or null while the count is still loading. */
  dirty: number | null;
  isMain: boolean;
  locked: boolean;
  /** git can no longer find the directory. */
  prunable?: boolean;
}): RemovalBlocker | null {
  if (state.isMain) {
    return "main";
  }
  if (state.prunable) {
    // The files are already gone, so there is nothing to lose and nothing to
    // count. Refusing here would strand the entry: it could never be removed.
    return null;
  }
  if (state.locked) {
    return "locked";
  }
  // A count that has not landed is not evidence there is nothing to lose.
  if (state.dirty === null || state.dirty > 0) {
    return "dirty";
  }
  return null;
}

/**
 * Every terminal pane whose shell sits in this worktree.
 *
 * These have to be closed before `git worktree remove` runs: on Windows a live
 * pty holds a handle on its working directory and the directory cannot be
 * deleted, which fails the removal halfway and leaves git's metadata pointing at
 * a directory that is half gone. macOS unlinks it happily, which is exactly why
 * this is easy to get wrong here and only break on someone else's machine.
 */
export function panesInWorktree(
  tabs: readonly Tab[],
  worktreePath: string,
  windows: boolean = IS_WINDOWS,
): OpenWorktreePane[] {
  const found: OpenWorktreePane[] = [];
  for (const tab of tabs) {
    for (const pane of computeLayout(tab.paneTree)) {
      const cwd = localTerminalCwd(pane.content, tab.cwd);
      if (cwd && isUnder(cwd, worktreePath, windows)) {
        found.push({ tabId: tab.id, leafId: pane.id });
      }
    }
  }
  return found;
}
