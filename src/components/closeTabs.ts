import { useEditorStore } from "@/modules/editor/store/editorStore";
import { useTabsStore, tabHasDirtyEditor, type Tab } from "@/stores/tabsStore";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import { guardPaneClose } from "@/modules/terminal/lib/paneSessions";

/**
 * Closes several tabs at once without asking per tab. Tabs that would lose
 * work are left open instead: pinned tabs, tabs with unsaved editors, and
 * tabs whose terminals are still running a command.
 */
export function closeTabsSafely(tabs: Tab[]): void {
  const { closeTab } = useTabsStore.getState();
  const buffers = useEditorStore.getState().buffers;
  for (const tab of tabs) {
    if (tab.pinned || tabHasDirtyEditor(tab, buffers)) {
      continue;
    }
    guardPaneClose(computeLayout(tab.paneTree), () => closeTab(tab.id), () => {});
  }
}

/** The other tabs of `id`'s space. */
export function otherTabsOf(id: string): Tab[] {
  const { tabs } = useTabsStore.getState();
  const tab = tabs.find((t) => t.id === id);
  return tab ? tabs.filter((t) => t.spaceId === tab.spaceId && t.id !== id) : [];
}

/** The tabs to the right of `id` within its space. */
export function tabsRightOf(id: string): Tab[] {
  const { tabs } = useTabsStore.getState();
  const tab = tabs.find((t) => t.id === id);
  if (!tab) {
    return [];
  }
  const space = tabs.filter((t) => t.spaceId === tab.spaceId);
  return space.slice(space.findIndex((t) => t.id === id) + 1);
}
