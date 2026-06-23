import { create } from "zustand";

interface LiveSessionsState {
  /** Maps connectionId -> list of live sessionIds */
  sessions: Record<string, number[]>;
  /** Register a new live session for a connection. */
  register: (connectionId: string, sessionId: number) => void;
  /** Remove a session when it exits. Cleans up the key if no sessions remain. */
  unregister: (sessionId: number) => void;
  /** Return the list of live sessionIds for a connection (empty array if none). */
  sessionsFor: (connectionId: string) => number[];
}

export const liveSessionsStore = create<LiveSessionsState>()((set, get) => ({
  sessions: {},

  register: (connectionId, sessionId) =>
    set((prev) => ({
      sessions: {
        ...prev.sessions,
        [connectionId]: [...(prev.sessions[connectionId] ?? []), sessionId],
      },
    })),

  unregister: (sessionId) =>
    set((prev) => {
      const next: Record<string, number[]> = {};
      for (const [connId, ids] of Object.entries(prev.sessions)) {
        const filtered = ids.filter((id) => id !== sessionId);
        if (filtered.length > 0) {
          next[connId] = filtered;
        }
        // Drop the key entirely if the list becomes empty
      }
      return { sessions: next };
    }),

  sessionsFor: (connectionId) => get().sessions[connectionId] ?? [],
}));

/** Hook alias — use inside React components. */
export const useLiveSessionsStore = liveSessionsStore;
