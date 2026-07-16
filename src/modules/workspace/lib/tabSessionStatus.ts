import type { Tab } from "@/stores/tabsStore";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import type { SessionStatus } from "@/modules/claude-progress/lib/sessionStatus";
import { AGGREGATE_PRIORITY } from "@/modules/claude-progress/lib/sessionStatusStore";

/**
 * The session status to show on a tab's card: the highest-priority live status
 * among the tab's terminal panes, or null when none is running Claude.
 */
export function tabSessionStatus(
  tab: Tab,
  statuses: Record<string, SessionStatus>,
): SessionStatus | null {
  const present = new Set<SessionStatus>();
  for (const pane of computeLayout(tab.paneTree)) {
    if (pane.content?.kind === "terminal") {
      const status = statuses[pane.id];
      if (status) {
        present.add(status);
      }
    }
  }
  return AGGREGATE_PRIORITY.find((status) => present.has(status)) ?? null;
}
