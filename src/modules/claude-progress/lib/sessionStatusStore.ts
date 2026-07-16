import { create } from "zustand";
import type { SessionStatus } from "./sessionStatus";
import type { AgentKind } from "./codexNormalize";
import { probeStoreUpdate } from "@/lib/perfProbe";

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

/** Most-to-least urgent, matching tabSessionStatus so an icon and a card agree. */
const AGGREGATE_PRIORITY: SessionStatus[] = ["waiting-approval", "active", "thinking", "idle"];

/**
 * The single most-urgent live status across every tracked terminal leaf, or null
 * when nothing is tracked. Used to badge a dock strip icon so a glance shows
 * whether an agent anywhere is working or waiting on the user.
 */
export function aggregateSessionStatus(
  statuses: Record<string, SessionStatus>,
): SessionStatus | null {
  const present = new Set(Object.values(statuses));
  return AGGREGATE_PRIORITY.find((status) => present.has(status)) ?? null;
}

/** Selector form of {@link aggregateSessionStatus}; returns a stable primitive so
 *  a subscriber only re-renders when the aggregate status actually changes. */
export const selectSessionStatus = (state: SessionStatusState): SessionStatus | null =>
  aggregateSessionStatus(state.statuses);

export const useSessionStatusStore = create<SessionStatusState>((set) => ({
  statuses: {},
  agents: {},
  setStatus: (leafId, status) =>
    set((s) => {
      if (s.statuses[leafId] === status) {
        return s;
      }
      probeStoreUpdate("status");
      return { statuses: { ...s.statuses, [leafId]: status } };
    }),
  setAgent: (leafId, agent) =>
    set((s) => {
      if (s.agents[leafId] === agent) {
        return s;
      }
      probeStoreUpdate("agent");
      return { agents: { ...s.agents, [leafId]: agent } };
    }),
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
