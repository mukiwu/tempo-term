import type { Tab } from "@/stores/tabsStore";
import type { SessionStatus } from "@/modules/claude-progress/lib/sessionStatus";
import type { AgentKind } from "@/modules/claude-progress/lib/codexNormalize";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import { agentLabel } from "@/modules/workspace/lib/agentLabel";

/** A terminal pane running an agent that can receive a comment batch. */
export interface AgentTarget {
  leafId: string;
  tabId: string;
  label: string;
}

/**
 * Every terminal pane with a live agent session, labeled "Agent · tab title".
 * Same detection the workspace cards use: a pane counts only while it has
 * both a session status and a classified agent.
 */
export function collectAgentTargets(
  tabs: Tab[],
  statuses: Record<string, SessionStatus>,
  agents: Record<string, AgentKind>,
): AgentTarget[] {
  const targets: AgentTarget[] = [];
  for (const tab of tabs) {
    for (const pane of computeLayout(tab.paneTree)) {
      if (pane.content.kind !== "terminal") {
        continue;
      }
      const agent = agents[pane.id];
      if (!agent || !statuses[pane.id]) {
        continue;
      }
      targets.push({
        leafId: pane.id,
        tabId: tab.id,
        label: `${agentLabel(agent)} · ${tab.title}`,
      });
    }
  }
  return targets;
}
