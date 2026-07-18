import { create } from "zustand";
import { progressKey } from "@/modules/claude-progress/lib/progressStore";
import type { AgentKind } from "@/modules/claude-progress/lib/codexNormalize";
import { claudeSessionTitle, codexSessionTitle } from "./titlesBridge";
import { probeStoreUpdate } from "@/lib/perfProbe";

/** One session whose auto title we want kept fresh. */
export interface TitleTarget {
  cwd: string;
  agent: AgentKind;
  sessionId?: string;
  /**
   * Opaque freshness stamp built by the caller from every input that can
   * change the title (the progress epoch plus the contributing panes' status
   * epochs). Compared for EQUALITY only — any change, in any direction, is one
   * refetch. Equality is what makes pane membership changes safe: epochs from
   * different panes are not comparable, so no ordering may ever be assumed.
   */
  fingerprint: string;
}

/** Cache key for one exact session, with the legacy per-cwd key as fallback. */
export function titleKey(t: {
  cwd: string;
  agent: AgentKind;
  sessionId?: string;
}): string {
  return t.sessionId ? `${t.agent}:${t.cwd}:${t.sessionId}` : progressKey(t.cwd, t.agent);
}

interface TitlesStoreState {
  /** Auto session title per session, keyed by {@link titleKey}. */
  titles: Record<string, string>;
  /**
   * Fingerprint each key was last fetched at — recorded even when the fetch
   * found no title, so a titleless session is not re-fetched on every sibling
   * bump. Its keyset is a superset of `titles`' (every landing writes it).
   */
  fetchedFingerprints: Record<string, string>;
  /**
   * The fetch currently in flight per key: its process-unique generation and
   * the fingerprint it was launched for. A result only lands while its
   * generation is still the current one — a fingerprint change during flight
   * launches a superseding fetch (new generation), a revert to the cached
   * stamp cancels the entry, and prune removes it, so a landing only ever
   * happens for a stamp somebody still wants: a stale fetch can neither
   * overwrite a newer result, leave a changed fingerprint unfetched, nor
   * resurrect a pruned key (ABA-safe).
   */
  inFlight: Record<string, { generation: number; fingerprint: string }>;
  /**
   * Fetch and cache titles for a batch of sessions. Targets whose cached
   * fingerprint matches, or that already have a fetch in flight, are skipped
   * (no IPC). Results land in one store update, and the `titles` reference
   * only changes when some title text actually changed — every open card
   * subscribes to it, so a bookkeeping-only update must not re-render them.
   */
  refresh: (targets: TitleTarget[]) => Promise<void>;
  /**
   * Drop cached entries whose key is not in `liveKeys`. Session-scoped keys
   * are minted per Claude session, so without pruning the cache would grow for
   * the app's lifetime (progressStore.syncSessions plays the same role for
   * progress).
   */
  prune: (liveKeys: ReadonlySet<string>) => void;
}

async function fetchTitle(target: TitleTarget): Promise<string | null> {
  try {
    if (target.agent === "codex") {
      return (await codexSessionTitle(target.cwd)) ?? null;
    }
    return (await claudeSessionTitle(target.cwd, target.sessionId)) ?? null;
  } catch {
    // No transcript yet, or no backend in tests/web preview; keep last value.
    return null;
  }
}

/** Process-wide fetch counter. Never reused, even across prune-and-relaunch of
 *  the same key — that uniqueness is what defeats the ABA race. */
let nextGeneration = 1;

export const useTitlesStore = create<TitlesStoreState>((set, get) => ({
  titles: {},
  fetchedFingerprints: {},
  inFlight: {},

  refresh: async (targets) => {
    const { fetchedFingerprints, inFlight } = get();
    const stale: TitleTarget[] = [];
    const cancels: string[] = [];
    for (const t of targets) {
      const key = titleKey(t);
      if (fetchedFingerprints[key] === t.fingerprint) {
        // The cache already answers this stamp, so any fetch still in flight
        // is for some other, no-longer-wanted stamp (a landing records the
        // stamp and clears the entry together, so cache and in-flight can
        // never hold the same one). Cancel it — e.g. the fingerprint
        // reverted because a pane briefly joined and left a shared key — so
        // its landing cannot displace the already-correct bookkeeping.
        if (inFlight[key] !== undefined) {
          cancels.push(key);
        }
        continue;
      }
      // A fetch in flight for a different stamp does not block a launch: the
      // new one supersedes it (the old landing is dropped by the generation
      // check), because nothing else would ever refetch the changed
      // fingerprint — landings don't re-fire the caller's effect. Only an
      // in-flight fetch for this exact stamp dedupes.
      if (inFlight[key]?.fingerprint !== t.fingerprint) {
        stale.push(t);
      }
    }
    if (stale.length === 0 && cancels.length === 0) {
      return;
    }

    const launches = stale.map((target) => ({
      target,
      key: titleKey(target),
      generation: nextGeneration++,
    }));
    set((state) => {
      const next = { ...state.inFlight };
      for (const key of cancels) {
        delete next[key];
      }
      for (const launch of launches) {
        next[launch.key] = {
          generation: launch.generation,
          fingerprint: launch.target.fingerprint,
        };
      }
      return { inFlight: next };
    });
    if (launches.length === 0) {
      return;
    }

    const results = await Promise.all(
      launches.map(async (launch) => ({ ...launch, title: await fetchTitle(launch.target) })),
    );

    set((state) => {
      let titles = state.titles;
      const fingerprints = { ...state.fetchedFingerprints };
      const nextInFlight = { ...state.inFlight };
      let landed = false;
      let titlesChanged = false;
      for (const { target, key, generation, title } of results) {
        // Superseded, pruned, or pruned-and-relaunched fetches must not land.
        if (nextInFlight[key]?.generation !== generation) {
          continue;
        }
        delete nextInFlight[key];
        fingerprints[key] = target.fingerprint;
        landed = true;
        // A titleless fetch still records its fingerprint (negative cache) but
        // keeps any existing title — a transcript never loses a title it had.
        if (title !== null && titles[key] !== title) {
          if (!titlesChanged) {
            titles = { ...titles };
          }
          titles[key] = title;
          titlesChanged = true;
        }
      }
      if (!landed) {
        return state;
      }
      if (!titlesChanged) {
        return { fetchedFingerprints: fingerprints, inFlight: nextInFlight };
      }
      probeStoreUpdate("title");
      return { titles, fetchedFingerprints: fingerprints, inFlight: nextInFlight };
    });
  },

  prune: (liveKeys) =>
    set((state) => {
      // fetchedFingerprints covers every landed key (titles included);
      // inFlight covers first fetches that have not landed yet.
      const dead = Object.keys(state.fetchedFingerprints)
        .concat(Object.keys(state.inFlight))
        .filter((key) => !liveKeys.has(key));
      if (dead.length === 0) {
        return state;
      }
      const fetchedFingerprints = { ...state.fetchedFingerprints };
      const inFlight = { ...state.inFlight };
      // Only reclone titles when a dead key actually holds one, so a prune of
      // bookkeeping-only entries cannot re-render every card.
      const titlesDead = dead.some((key) => key in state.titles);
      const titles = titlesDead ? { ...state.titles } : state.titles;
      for (const key of dead) {
        delete fetchedFingerprints[key];
        delete inFlight[key];
        if (titlesDead) {
          delete titles[key];
        }
      }
      return { titles, fetchedFingerprints, inFlight };
    }),
}));
