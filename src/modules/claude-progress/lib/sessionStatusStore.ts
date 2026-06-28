import { create } from "zustand";
import type { SessionStatus } from "./sessionStatus";
import type { AgentKind } from "./codexNormalize";

interface SessionStatusState {
  /** Live agent status per terminal leaf id; absence means no badge. */
  statuses: Record<string, SessionStatus>;
  /**
   * Which agent (Claude or Codex) is running in each terminal leaf, derived from
   * the pane's foreground process. Lets a card label each pane's session even
   * when two panes share one directory.
   */
  agents: Record<string, AgentKind>;
  setStatus: (leafId: string, status: SessionStatus) => void;
  setAgent: (leafId: string, agent: AgentKind) => void;
  clear: (leafId: string) => void;
}

export const useSessionStatusStore = create<SessionStatusState>((set) => ({
  statuses: {},
  agents: {},
  setStatus: (leafId, status) =>
    set((s) =>
      s.statuses[leafId] === status ? s : { statuses: { ...s.statuses, [leafId]: status } },
    ),
  setAgent: (leafId, agent) =>
    set((s) =>
      s.agents[leafId] === agent ? s : { agents: { ...s.agents, [leafId]: agent } },
    ),
  clear: (leafId) =>
    set((s) => {
      const hasStatus = leafId in s.statuses;
      const hasAgent = leafId in s.agents;
      if (!hasStatus && !hasAgent) {
        return s;
      }
      // Only rebuild the map the leaf is actually in, so clearing an
      // agent-only leaf doesn't churn the statuses ref the notifier watches.
      const next: Partial<SessionStatusState> = {};
      if (hasStatus) {
        const statuses = { ...s.statuses };
        delete statuses[leafId];
        next.statuses = statuses;
      }
      if (hasAgent) {
        const agents = { ...s.agents };
        delete agents[leafId];
        next.agents = agents;
      }
      return next;
    }),
}));
