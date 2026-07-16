import { IS_WINDOWS } from "@/lib/platform";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import type { Tab } from "@/stores/tabsStore";
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
      if (pane.content?.kind !== "terminal") {
        continue;
      }
      // A pane's live cwd wins; one spawned moments ago has not reported yet and
      // only the tab's starting dir says where it is.
      const cwd = pane.content.cwd || tab.cwd;
      if (cwd && isUnder(cwd, worktreePath, windows)) {
        return { tabId: tab.id, leafId: pane.id };
      }
    }
  }
  return null;
}
