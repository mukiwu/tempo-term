import type { Tab } from "@/stores/tabsStore";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";

/**
 * One currently-running agent session, surfaced at the top of the sessions
 * sidebar so it's a single click away instead of waiting for Task 8's
 * historical index to pick it up once the session ends. Distinct from
 * `SessionSummary` (the indexed, ended session) — this is a live view
 * derived straight from the tabs and session-status stores.
 *
 * `agent` is `string | undefined` rather than the brief's plain `string`:
 * the foreground-process poll that classifies a pane's agent runs
 * independently of (and slightly behind) the status hook, so a session can
 * have a live status before it has a known agent. `collectTabSessions`
 * (Task 9, workspace module) already treats a tab's per-pane agent the same
 * way — this mirrors that precedent instead of inventing a fallback agent
 * label.
 */
export interface LiveSession {
  tabId: string;
  leafId: string;
  tabTitle: string;
  agent: string | undefined;
  status: string;
  cwd: string | null;
}

/**
 * Every terminal pane, across all tabs, that currently has a live status —
 * i.e. an agent is actively running in it. Pure over plain snapshots (not
 * the zustand hooks themselves), so it's trivially testable and callers can
 * subscribe to exactly the three inputs it needs without pulling in more of
 * either store.
 */
export function deriveLiveSessions(
  tabs: Tab[],
  statuses: Record<string, string>,
  agents: Record<string, string>,
): LiveSession[] {
  const sessions: LiveSession[] = [];
  for (const tab of tabs) {
    for (const pane of computeLayout(tab.paneTree)) {
      if (pane.content.kind !== "terminal") {
        continue;
      }
      const status = statuses[pane.id];
      if (!status) {
        continue;
      }
      sessions.push({
        tabId: tab.id,
        leafId: pane.id,
        tabTitle: tab.title,
        agent: agents[pane.id],
        status,
        cwd: pane.content.cwd ?? tab.cwd ?? null,
      });
    }
  }
  return sessions;
}
