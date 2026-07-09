import { useTabsStore } from "@/stores/tabsStore";
import { findPaneContent } from "@/modules/terminal/lib/terminalLayout";

const savers = new Map<string, () => void>();

/** An editor pane registers how to save itself, keyed by its leaf id. */
export function registerEditorSaver(leafId: string, save: () => void): void {
  savers.set(leafId, save);
}

export function unregisterEditorSaver(leafId: string): void {
  savers.delete(leafId);
}

/**
 * Save the focused editor pane, driven by the File menu's Save action.
 * Returns false when the active tab's focused leaf isn't an editor, or has no
 * saver registered — so callers can no-op instead of throwing.
 */
export function saveFocusedEditor(): boolean {
  const state = useTabsStore.getState();
  const tab = state.tabs.find((t) => t.id === state.activeId);
  if (!tab) return false;
  const content = findPaneContent(tab.paneTree, tab.activeLeafId);
  if (content?.kind !== "editor") return false;
  const save = savers.get(tab.activeLeafId);
  if (!save) return false;
  save();
  return true;
}
