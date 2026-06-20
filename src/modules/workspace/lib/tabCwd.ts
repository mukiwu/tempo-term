import type { Tab } from "@/stores/tabsStore";
import { computeLayout, findPaneContent } from "@/modules/terminal/lib/terminalLayout";

/**
 * The directory a tab's card uses to look up Claude status, git branch, and PR.
 * Prefers the active terminal pane's live cwd, then the tab's stored cwd, then
 * the first terminal pane found in the layout; null when the tab has no terminal.
 */
export function deriveTabCwd(tab: Tab): string | null {
  const active = findPaneContent(tab.paneTree, tab.activeLeafId);
  if (active?.kind === "terminal" && active.cwd) {
    return active.cwd;
  }
  if (tab.cwd) {
    return tab.cwd;
  }
  for (const pane of computeLayout(tab.paneTree)) {
    if (pane.content.kind === "terminal" && pane.content.cwd) {
      return pane.content.cwd;
    }
  }
  return null;
}
