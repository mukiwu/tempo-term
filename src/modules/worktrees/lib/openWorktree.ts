import { IS_WINDOWS } from "@/lib/platform";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import { MAX_PANES, type Tab } from "@/stores/tabsStore";
import { localTerminalCwd } from "./panes";
import { isUnder } from "./paths";

/** Where a worktree is already open. */
export interface OpenWorktreePane {
  tabId: string;
  leafId: string;
}

/**
 * The pane already sitting in this worktree, if there is one.
 *
 * Opening a worktree that is already open should take you to it rather than
 * spawn a second shell in the same directory — two terminals in one worktree is
 * a thing to ask for, not a thing to get by accident.
 *
 * A pane counts as being in the worktree when it has cd'd anywhere inside it,
 * not only at its root: `cd src` does not leave the worktree.
 *
 * `windows` is a parameter rather than a direct `IS_WINDOWS` read so both
 * platforms' behavior is covered by tests on either machine.
 */
export function findWorktreePane(
  tabs: readonly Tab[],
  worktreePath: string,
  windows: boolean = IS_WINDOWS,
): OpenWorktreePane | null {
  for (const tab of tabs) {
    for (const pane of computeLayout(tab.paneTree)) {
      const cwd = localTerminalCwd(pane.content, tab.cwd);
      if (cwd && isUnder(cwd, worktreePath, windows)) {
        return { tabId: tab.id, leafId: pane.id };
      }
    }
  }
  return null;
}

/**
 * Whether a tab can take a split.
 *
 * A launcher tab is not a candidate: `TabsArea` renders `LauncherPanel` for it
 * and never looks at its pane tree, so a pane split into one silently vanishes.
 * And `splitPaneWith` takes an explicit target rather than the active pane, so
 * unlike `splitActivePane` it does not hold the pane cap for its callers.
 */
export function canSplitInto(tab: Tab | null | undefined): tab is Tab {
  return !!tab && tab.kind !== "launcher";
}

/** Whether that tab still has room. Separate from `canSplitInto`: a full tab is
 * a "not right now", which the UI says by disabling rather than hiding. */
export function hasPaneRoom(tab: Tab): boolean {
  return tab.paneOrder.length < MAX_PANES;
}
