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

/** One git working tree a tab has a terminal pane in. */
export interface TabGitPlace {
  /** The directory to look the place up by: the first pane's own cwd. */
  cwd: string;
  /** The panes sitting in it, in layout order. */
  leafIds: string[];
}

/**
 * Every working tree a tab's terminal panes sit in, one entry each, in layout
 * order. Panes in two subdirectories of the same repo are one place once
 * their worktree info names the same root; until it loads, each cwd stands
 * for itself.
 *
 * A tab split between a repo's main working tree and a worktree cut from it
 * lists both — the card is the whole tab, not whichever pane last had focus.
 */
export function tabGitPlaces(
  tab: Tab,
  infos: Record<string, { cwd: string } | undefined>,
): TabGitPlace[] {
  const places = new Map<string, TabGitPlace>();
  for (const pane of computeLayout(tab.paneTree)) {
    if (pane.content.kind !== "terminal") {
      continue;
    }
    const cwd = pane.content.cwd ?? tab.cwd ?? null;
    if (!cwd) {
      continue;
    }
    const key = infos[cwd]?.cwd ?? cwd;
    const place = places.get(key);
    if (place) {
      place.leafIds.push(pane.id);
    } else {
      places.set(key, { cwd, leafIds: [pane.id] });
    }
  }
  return [...places.values()];
}
