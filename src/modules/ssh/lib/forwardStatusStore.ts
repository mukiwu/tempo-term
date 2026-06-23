import { create } from "zustand";

export type ForwardState = "starting" | "active" | "failed" | "stopped";

export interface ForwardStatus {
  sessionId: number;
  forwardId: string;
  state: ForwardState;
  error?: string;
}

interface ForwardStatusState {
  statuses: Record<number, Record<string, ForwardStatus>>;
  applyStatus: (s: ForwardStatus) => void;
  clearSession: (sessionId: number) => void;
  getStatus: (sessionId: number, forwardId: string) => ForwardStatus | undefined;
}

export const useForwardStatusStore = create<ForwardStatusState>()((set, get) => ({
  statuses: {},
  applyStatus: (s) =>
    set((prev) => ({
      statuses: {
        ...prev.statuses,
        [s.sessionId]: { ...prev.statuses[s.sessionId], [s.forwardId]: s },
      },
    })),
  clearSession: (sessionId) =>
    set((prev) => {
      const next = { ...prev.statuses };
      delete next[sessionId];
      return { statuses: next };
    }),
  getStatus: (sessionId, forwardId) => get().statuses[sessionId]?.[forwardId],
}));
