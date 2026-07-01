/** One tab's horizontal position in the tab bar, read live from the DOM. */
export interface TabBarSlot {
  id: string;
  left: number;
  width: number;
}

/** Every tab's current on-screen rect, in DOM order, or an empty array if the tab bar isn't mounted. */
export function tabRectsInTabBar(): TabBarSlot[] {
  const bar = document.querySelector("[data-tab-bar]");
  if (!bar) {
    return [];
  }
  return Array.from(bar.querySelectorAll<HTMLElement>('[role="tab"]')).map((el) => {
    const rect = el.getBoundingClientRect();
    return { id: el.dataset.tabId ?? "", left: rect.left, width: rect.width };
  });
}

/**
 * Which existing tab a drop at `pointerX` should land before, or null to
 * land at the very end (after the last tab, or immediately when there are
 * no tabs at all). Tabs must be in left-to-right DOM order.
 */
export function nearestTabInsertion(tabs: TabBarSlot[], pointerX: number): string | null {
  for (const tab of tabs) {
    if (pointerX < tab.left + tab.width / 2) {
      return tab.id;
    }
  }
  return null;
}
