import { create } from "zustand";
import type { SessionStatus } from "./sessionStatus";
import type { AgentKind } from "./codexNormalize";
import { probeStoreUpdate } from "@/lib/perfProbe";

interface SessionStatusState {
  /** Live agent status per terminal leaf id; absence means no badge. */
  statuses: Record<string, SessionStatus>;
  /** Claude session id per terminal leaf id, when reported by the local hook. */
  sessionIds: Record<string, string>;
  /** Counter bumped whenever a leaf's live status actually changes. */
  statusEpochs: Record<string, number>;
  /**
   * Which agent (Claude or Codex) is running in each terminal leaf, derived from
   * the pane's foreground process. Lets a card label each pane's session even
   * when two panes share one directory.
   */
  agents: Record<string, AgentKind>;
  setStatus: (leafId: string, status: SessionStatus) => void;
  setSessionId: (leafId: string, sessionId: string) => void;
  setAgent: (leafId: string, agent: AgentKind) => void;
  clear: (leafId: string) => void;
}

/**
 * Most-to-least urgent. Exported as the single source of this order: a
 * workspace card and a worktree row both reduce the same per-leaf statuses,
 * and a second copy of the list is exactly how they start disagreeing.
 */
export const AGGREGATE_PRIORITY: SessionStatus[] = [
  "waiting-approval",
  "active",
  "thinking",
  "idle",
];

/** `map` without `key`; the same reference when the key is absent, so
 *  subscribers comparing slice references still short-circuit. */
function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) {
    return map;
  }
  const next = { ...map };
  delete next[key];
  return next;
}

/**
 * The transitions after which a transcript's title may have changed: the first
 * prompt lands with UserPromptSubmit (thinking) and ai-titles / renames are on
 * disk by the turn's Stop (idle). The active/waiting-approval churn between
 * tool calls never carries a title, so bumping the title epoch there would
 * refetch whole transcripts several times per turn for nothing.
 */
const TITLE_EPOCH_STATUSES: SessionStatus[] = ["idle", "thinking"];

export const useSessionStatusStore = create<SessionStatusState>((set) => ({
  statuses: {},
  sessionIds: {},
  statusEpochs: {},
  agents: {},
  setStatus: (leafId, status) =>
    set((s) => {
      if (s.statuses[leafId] === status) {
        return s;
      }
      probeStoreUpdate("status");
      const statusEpochs = TITLE_EPOCH_STATUSES.includes(status)
        ? { ...s.statusEpochs, [leafId]: (s.statusEpochs[leafId] ?? 0) + 1 }
        : s.statusEpochs;
      return {
        statuses: { ...s.statuses, [leafId]: status },
        statusEpochs,
      };
    }),
  setSessionId: (leafId, sessionId) =>
    set((s) => {
      if (s.sessionIds[leafId] === sessionId) {
        return s;
      }
      return { sessionIds: { ...s.sessionIds, [leafId]: sessionId } };
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
      if (
        !(leafId in s.statuses) &&
        !(leafId in s.sessionIds) &&
        !(leafId in s.agents) &&
        !(leafId in s.statusEpochs)
      ) {
        return s;
      }
      // `without` keeps an untouched map's reference, so clearing an
      // agent-only leaf doesn't churn the statuses ref the notifier watches.
      // Deleting the status epoch is safe: title freshness compares
      // fingerprints for equality (useWorkspaceTitles), so the removal is
      // just one more fingerprint change — nothing orders epochs over time.
      return {
        statuses: without(s.statuses, leafId),
        sessionIds: without(s.sessionIds, leafId),
        agents: without(s.agents, leafId),
        statusEpochs: without(s.statusEpochs, leafId),
      };
    }),
}));
