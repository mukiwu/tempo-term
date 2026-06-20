import { create } from "zustand";
import { createNormalizer, type Normalizer } from "./normalize";
import { emptyProgressState, reduceProgress, type ProgressState } from "./progressState";

interface ProgressStoreState {
  /** Accumulated progress per watched project directory (keyed by cwd). */
  sessions: Record<string, ProgressState>;
  /**
   * A per-cwd counter bumped whenever that directory switches to a new session
   * (a reset). Consumers watch it to know when to refetch derived data like the
   * session title.
   */
  sessionEpochs: Record<string, number>;
  /**
   * Feed raw transcript lines (from the backend watcher) for one cwd. `reset`
   * marks the first batch of a newly started session, clearing prior progress.
   */
  pushLines: (cwd: string, lines: string[], reset: boolean) => void;
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
  sessionEpochs: {},

  pushLines: (cwd, lines, reset) =>
    set((state) => {
      // A reset means the backend switched this cwd to a new session: start its
      // normalizer and accumulated state fresh so the old session's leftovers
      // (e.g. a tool that never finished) can't linger forever.
      if (reset) {
        normalizers.set(cwd, createNormalizer());
      }
      // A new session for this cwd: bump its epoch so title consumers refetch.
      const sessionEpochs = reset
        ? { ...state.sessionEpochs, [cwd]: (state.sessionEpochs[cwd] ?? 0) + 1 }
        : state.sessionEpochs;
      const normalizer = normalizerFor(cwd);
      const previous = reset ? undefined : state.sessions[cwd];
      let next = previous ?? emptyProgressState();
      for (const line of lines) {
        for (const event of normalizer.push(line)) {
          next = reduceProgress(next, event);
        }
      }
      if (next === previous) {
        return { sessionEpochs };
      }
      // Don't materialize an empty session for a cwd whose lines produced nothing.
      if (!reset && previous === undefined && isEmptyProgress(next)) {
        return { sessionEpochs };
      }
      return { sessions: { ...state.sessions, [cwd]: next }, sessionEpochs };
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

/** True when a session has nothing worth showing (no activities, subagents, or todos). */
export function isEmptyProgress(progress: ProgressState): boolean {
  return (
    progress.activities.length === 0 &&
    progress.subagents.length === 0 &&
    progress.todos.length === 0
  );
}
