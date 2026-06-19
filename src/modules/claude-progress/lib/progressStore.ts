import { create } from "zustand";
import { createNormalizer, type Normalizer } from "./normalize";
import { emptyProgressState, reduceProgress, type ProgressState } from "./progressState";

interface ProgressStoreState {
  /** Accumulated progress per watched project directory (keyed by cwd). */
  sessions: Record<string, ProgressState>;
  /** Whether the floating progress panel is expanded. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  /** Feed raw transcript lines (from the backend watcher) for one cwd. */
  pushLines: (cwd: string, lines: string[]) => void;
  /** Keep only the sessions for `cwds`; drop progress for directories no longer watched. */
  syncSessions: (cwds: string[]) => void;
}

// Each cwd's normalizer is stateful (it pairs tool calls with their results), so
// the normalizers live alongside the store, one per watched directory.
const normalizers = new Map<string, Normalizer>();

function normalizerFor(cwd: string): Normalizer {
  let normalizer = normalizers.get(cwd);
  if (!normalizer) {
    normalizer = createNormalizer();
    normalizers.set(cwd, normalizer);
  }
  return normalizer;
}

export const useProgressStore = create<ProgressStoreState>((set) => ({
  sessions: {},
  panelOpen: false,

  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),

  pushLines: (cwd, lines) =>
    set((state) => {
      const normalizer = normalizerFor(cwd);
      let next = state.sessions[cwd] ?? emptyProgressState();
      for (const line of lines) {
        for (const event of normalizer.push(line)) {
          next = reduceProgress(next, event);
        }
      }
      if (next === state.sessions[cwd]) {
        return {};
      }
      return { sessions: { ...state.sessions, [cwd]: next } };
    }),

  syncSessions: (cwds) =>
    set((state) => {
      const keep = new Set(cwds);
      for (const cwd of normalizers.keys()) {
        if (!keep.has(cwd)) {
          normalizers.delete(cwd);
        }
      }
      const sessions: Record<string, ProgressState> = {};
      for (const [cwd, progress] of Object.entries(state.sessions)) {
        if (keep.has(cwd)) {
          sessions[cwd] = progress;
        }
      }
      return { sessions };
    }),
}));

/** In-flight work for one session, used to badge the panel section. */
export function activeCount(progress: ProgressState): number {
  const runningSubagents = progress.subagents.filter((s) => s.status === "running").length;
  return progress.runningTools.length + runningSubagents;
}

/** Total in-flight work across all sessions, used to badge the status-bar icon. */
export function totalActiveCount(sessions: Record<string, ProgressState>): number {
  return Object.values(sessions).reduce((sum, progress) => sum + activeCount(progress), 0);
}

/** True when a session has nothing worth showing (no tools, subagents, or todos). */
export function isEmptyProgress(progress: ProgressState): boolean {
  return (
    progress.runningTools.length === 0 &&
    progress.subagents.length === 0 &&
    progress.todos.length === 0
  );
}
