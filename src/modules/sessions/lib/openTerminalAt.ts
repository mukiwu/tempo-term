import { useTabsStore } from "@/stores/tabsStore";

/** Opens a new terminal tab rooted at `cwd` (e.g. the project view's
 *  "open a terminal here"). Returns the created tab's id. */
export function openTerminalAt(cwd: string): string {
  return useTabsStore.getState().newTerminalTab(cwd);
}
