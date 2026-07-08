import type { Tab } from "@/stores/tabsStore";

/**
 * The title shown on a workspace card's header. A manual rename always wins;
 * otherwise the resolved auto title (a session's transcript title, picked by the
 * caller) is used, falling back to the tab's own title (cwd basename or default).
 */
export function selectCardTitle(
  tab: Pick<Tab, "renamed" | "title">,
  autoTitle: string | undefined,
): string {
  if (tab.renamed) {
    return tab.title;
  }
  return autoTitle ?? tab.title;
}
