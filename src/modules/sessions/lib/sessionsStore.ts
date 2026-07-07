import { create } from "zustand";
import {
  sessionsList,
  sessionsPin,
  sessionsStart,
  type SessionAgent,
  type SessionSummary,
} from "./sessionsBridge";

interface SessionsState {
  sessions: SessionSummary[];
  loaded: boolean;
  query: string;
  agentFilter: SessionAgent | "all";
  modelFilter: string;
  selectedId: string | null;
  /** The project cwd shown by the project view, or `null` when it's not
   *  open. Mutually exclusive with `selectedId` — selecting one clears the
   *  other, since the main area shows exactly one of dashboard / project
   *  view / session transcript at a time. */
  selectedProject: string | null;
  /** Reloads `sessions` from the index. Leaves state unchanged on error. */
  refresh: () => Promise<void>;
  /** Starts the backend index (idempotent), then refreshes. */
  start: () => Promise<void>;
  setQuery: (query: string) => void;
  setAgentFilter: (filter: SessionAgent | "all") => void;
  setModelFilter: (model: string) => void;
  select: (id: string | null) => void;
  selectProject: (cwd: string | null) => void;
  /** Flips a session's pinned state optimistically, then persists it;
   *  re-syncs from the backend if the write fails. */
  togglePin: (id: string) => Promise<void>;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  loaded: false,
  query: "",
  agentFilter: "all",
  modelFilter: "all",
  selectedId: null,
  selectedProject: null,

  refresh: async () => {
    try {
      const sessions = await sessionsList();
      set({ sessions, loaded: true });
    } catch {
      // Leave state unchanged; the caller can retry.
    }
  },

  start: async () => {
    try {
      await sessionsStart();
      await get().refresh();
    } catch {
      // Leave state unchanged; the caller can retry.
    }
  },

  setQuery: (query) => set({ query }),
  setAgentFilter: (agentFilter) => set({ agentFilter }),
  setModelFilter: (modelFilter) => set({ modelFilter }),
  select: (selectedId) => set({ selectedId, selectedProject: null }),
  selectProject: (selectedProject) => set({ selectedProject, selectedId: null }),

  togglePin: async (id) => {
    const before = get().sessions;
    const target = before.find((s) => s.id === id);
    if (!target) {
      return;
    }

    const nextPinned = !target.pinned;
    set({
      sessions: before.map((s) => (s.id === id ? { ...s, pinned: nextPinned } : s)),
    });

    try {
      await sessionsPin(id, nextPinned);
    } catch {
      // The optimistic flip may be wrong; resync from the backend.
      await get().refresh();
    }
  },
}));

/**
 * Pure selector splitting `sessions` into pinned (sorted by most recently
 * ended) and history (everything else), after applying the agent filter, the
 * model filter, and a case-insensitive title/project_cwd query match.
 * Exported for tests and for the sessions panel to derive its two list
 * sections.
 */
export function visibleSessions(
  sessions: SessionSummary[],
  query: string,
  agentFilter: SessionAgent | "all",
  modelFilter: string,
): { pinned: SessionSummary[]; history: SessionSummary[] } {
  const q = query.trim().toLowerCase();

  const filtered = sessions.filter((s) => {
    if (agentFilter !== "all" && s.agent !== agentFilter) {
      return false;
    }
    if (modelFilter !== "all" && s.model !== modelFilter) {
      return false;
    }
    if (q === "") {
      return true;
    }
    return s.title.toLowerCase().includes(q) || s.project_cwd.toLowerCase().includes(q);
  });

  const pinned = filtered.filter((s) => s.pinned).sort((a, b) => b.ended_at - a.ended_at);
  const history = filtered.filter((s) => !s.pinned);

  return { pinned, history };
}
