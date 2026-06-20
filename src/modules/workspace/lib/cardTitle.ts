import type { Tab } from "@/stores/tabsStore";
import { deriveTabCwd } from "./tabCwd";

/**
 * The title shown on a workspace card. A manual rename always wins; otherwise
 * the auto title derived from the tab's Claude session is used, falling back to
 * the tab's own title (cwd basename or default name).
 */
export function selectCardTitle(tab: Tab, titles: Record<string, string>): string {
  if (tab.renamed) {
    return tab.title;
  }
  const cwd = deriveTabCwd(tab);
  const auto = cwd ? titles[cwd] : undefined;
  return auto ?? tab.title;
}
