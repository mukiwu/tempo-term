import type { Tab } from "@/stores/tabsStore";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import type { SessionStatus } from "@/modules/claude-progress/lib/sessionStatus";
import type { AgentKind } from "@/modules/claude-progress/lib/codexNormalize";

/** One running agent session inside a tab, tied to the pane it lives in. */
export interface TabSession {
  leafId: string;
  cwd: string | null;
  agent: AgentKind | undefined;
  sessionId: string | undefined;
  status: SessionStatus;
}

/**
 * The live agent sessions in a tab, one per terminal pane that currently has a
 * status. A pane's own cwd wins, falling back to the tab's starting cwd. The
 * agent comes from the per-leaf agent map; it may be undefined until the
 * foreground poll classifies the pane. A locally reported Claude session id is
 * carried from its own per-leaf map. Panes are returned in layout order.
 */
export function collectTabSessions(
  tab: Tab,
  statuses: Record<string, SessionStatus>,
  agents: Record<string, AgentKind>,
  sessionIds: Record<string, string>,
): TabSession[] {
  const sessions: TabSession[] = [];
  for (const pane of computeLayout(tab.paneTree)) {
    if (pane.content.kind !== "terminal") {
      continue;
    }
    const status = statuses[pane.id];
    if (!status) {
      continue;
    }
    sessions.push({
      leafId: pane.id,
      cwd: pane.content.cwd ?? tab.cwd ?? null,
      agent: agents[pane.id],
      sessionId: sessionIds[pane.id],
      status,
    });
  }
  return sessions;
}
