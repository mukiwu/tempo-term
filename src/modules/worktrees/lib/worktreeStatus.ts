import { IS_WINDOWS } from "@/lib/platform";
import type { AgentKind } from "@/modules/claude-progress/lib/codexNormalize";
import type { SessionStatus } from "@/modules/claude-progress/lib/sessionStatus";
import { AGGREGATE_PRIORITY } from "@/modules/claude-progress/lib/sessionStatusStore";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import type { Tab } from "@/stores/tabsStore";
import { isUnder } from "./paths";

/** What a worktree row shows: the most urgent agent state in it, and whose. */
export interface WorktreeActivity {
  status: SessionStatus | null;
  agent: AgentKind | null;
}

/**
 * The agent activity inside one worktree, joined from the two halves the app
 * keeps apart: statuses live per terminal leaf (`sessionStatusStore`), while the
 * directory a leaf sits in lives in the pane tree (`tabsStore`). A worktree owns
 * whichever terminal panes are cd'd into it, so this walks every tab's panes,
 * keeps the ones under `worktreePath`, and reduces their statuses with the same
 * priority a workspace card uses — a row and a card must never disagree.
 *
 * `windows` is threaded through to `isUnder` so both platforms are testable.
 */
export function worktreeSessionStatus(
  tabs: readonly Tab[],
  statuses: Record<string, SessionStatus>,
  agents: Record<string, AgentKind>,
  worktreePath: string,
  windows: boolean = IS_WINDOWS,
): WorktreeActivity {
  const agentByStatus = new Map<SessionStatus, AgentKind | null>();
  // An agent whose pane has not reported a status yet still names the row.
  let fallbackAgent: AgentKind | null = null;

  for (const tab of tabs) {
    for (const pane of computeLayout(tab.paneTree)) {
      if (pane.content?.kind !== "terminal") {
        continue;
      }
      // A pane's live cwd wins; a freshly spawned one that has not reported yet
      // falls back to the tab's starting dir, or a just-launched agent would
      // show nothing.
      const cwd = pane.content.cwd || tab.cwd;
      if (!cwd || !isUnder(cwd, worktreePath, windows)) {
        continue;
      }
      const agent = agents[pane.id] ?? null;
      if (agent && !fallbackAgent) {
        fallbackAgent = agent;
      }
      const status = statuses[pane.id];
      if (status && !agentByStatus.has(status)) {
        agentByStatus.set(status, agent);
      }
    }
  }

  const status = AGGREGATE_PRIORITY.find((candidate) => agentByStatus.has(candidate)) ?? null;
  return {
    status,
    // Only ever name the agent that actually holds the reported state. If that
    // pane's agent is not classified yet, say nothing rather than borrowing the
    // fallback: a row reading "Claude — waiting for you" while Claude is the
    // *idle* pane and something else is waiting is worse than an unnamed row.
    // The fallback exists solely for a worktree with an agent but no status yet.
    agent: status ? (agentByStatus.get(status) ?? null) : fallbackAgent,
  };
}
