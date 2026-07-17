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
  /** A project cwd to narrow the list to, or "all". */
  projectFilter: string;
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
  setProjectFilter: (cwd: string) => void;
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
  projectFilter: "all",
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
  setProjectFilter: (projectFilter) => set({ projectFilter }),
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
 * model filter, the project filter, and a case-insensitive title/project_cwd
 * query match. Exported for tests and for the sessions panel to derive its
 * two list sections.
 */
export function visibleSessions(
  sessions: SessionSummary[],
  query: string,
  agentFilter: SessionAgent | "all",
  modelFilter: string,
  projectFilter: string = "all",
): { pinned: SessionSummary[]; history: SessionSummary[] } {
  const q = query.trim().toLowerCase();

  // Self-heal a stranded model filter: if the selected model is no longer in
  // the dataset at all (its sessions were deleted while the sidebar — and its
  // reset effect — was unmounted), ignore it instead of returning an empty
  // list with no visible way back to "all". Keyed off the raw model set, so a
  // model that still exists but is narrowed to zero by other filters is
  // honored, not clamped.
  const effectiveModelFilter =
    modelFilter === "all" || sessions.some((s) => s.model === modelFilter) ? modelFilter : "all";

  // Same self-heal for the project filter.
  const effectiveProjectFilter =
    projectFilter === "all" || sessions.some((s) => s.project_cwd === projectFilter)
      ? projectFilter
      : "all";

  const filtered = sessions.filter((s) => {
    if (agentFilter !== "all" && s.agent !== agentFilter) {
      return false;
    }
    if (effectiveModelFilter !== "all" && s.model !== effectiveModelFilter) {
      return false;
    }
    if (effectiveProjectFilter !== "all" && s.project_cwd !== effectiveProjectFilter) {
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

/**
 * The distinct project cwds across `sessions` (empty cwds skipped), each with
 * a short display label for the project filter dropdown: the basename, with
 * parent segments prepended one at a time until labels stop colliding — two
 * different `~/work/app` and `~/side/app` projects show as `work/app` and
 * `side/app`, not two identical `app` entries. Sorted by label. Exported for
 * the sessions panel and its tests.
 */
export function projectOptions(
  sessions: SessionSummary[],
): Array<{ cwd: string; label: string }> {
  const cwds = [...new Set(sessions.map((s) => s.project_cwd).filter((c) => c !== ""))];
  // Split on both separators so Windows paths (C:\...) label correctly too.
  const segments = new Map(cwds.map((c) => [c, c.split(/[/\\]/).filter(Boolean)]));
  const depth = new Map(cwds.map((c) => [c, 1]));
  const label = (c: string) => {
    const parts = segments.get(c) ?? [];
    return parts.slice(-Math.min(depth.get(c) ?? 1, parts.length)).join("/") || c;
  };

  // Deepen every colliding label together until all are unique or fully
  // spelled out. Bounded: each pass grows at least one depth, and depth is
  // capped at the path's segment count.
  for (;;) {
    const groups = new Map<string, string[]>();
    for (const c of cwds) {
      const l = label(c);
      const group = groups.get(l);
      if (group) {
        group.push(c);
      } else {
        groups.set(l, [c]);
      }
    }
    let deepened = false;
    for (const group of groups.values()) {
      if (group.length < 2) {
        continue;
      }
      for (const c of group) {
        const max = segments.get(c)?.length ?? 1;
        const current = depth.get(c) ?? 1;
        if (current < max) {
          depth.set(c, current + 1);
          deepened = true;
        }
      }
    }
    if (!deepened) {
      return cwds
        .map((cwd) => ({ cwd, label: label(cwd) }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
  }
}
