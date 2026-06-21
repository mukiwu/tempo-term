import type { Tab } from "@/stores/tabsStore";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import type { SessionStatus } from "@/modules/claude-progress/lib/sessionStatus";

/** Most-to-least urgent, so a busy pane wins the badge over a quiet one. */
const PRIORITY: SessionStatus[] = ["waiting-approval", "active", "thinking", "idle"];

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
    if (pane.content.kind === "terminal") {
      const status = statuses[pane.id];
      if (status) {
        present.add(status);
      }
    }
  }
  return PRIORITY.find((status) => present.has(status)) ?? null;
}
