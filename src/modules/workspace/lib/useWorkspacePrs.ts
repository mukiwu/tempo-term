import { useEffect } from "react";
import { usePrStore, type PrSource } from "./prStore";

/** Refetch a cwd's PR at most this often (outside of explicit focus refreshes). */
const STALE_MS = 60_000;

/**
 * Keeps PR data in sync for the visible cards. Each card supplies its cwd and
 * branch; this fetches missing or stale entries when the set changes and
 * refetches everything when the window regains focus. Failures are swallowed by
 * the store, and the "off" source disables fetching entirely.
 */
export function useWorkspacePrs(pairs: { cwd: string; branch: string }[], source: PrSource): void {
  const refresh = usePrStore((s) => s.refresh);
  const key =
    pairs
      .map((p) => `${p.cwd}@${p.branch}`)
      .sort()
      .join("\n") + `|${source}`;

  useEffect(() => {
    if (source === "off") {
      return;
    }
    const fetchStale = () => {
      const now = Date.now();
      const { fetchedAt } = usePrStore.getState();
      for (const pair of pairs) {
        if (pair.branch && now - (fetchedAt[pair.cwd] ?? 0) >= STALE_MS) {
          void refresh(pair.cwd, pair.branch, source);
        }
      }
    };
    fetchStale();
    const onFocus = () => {
      for (const pair of pairs) {
        if (pair.branch) {
          void refresh(pair.cwd, pair.branch, source);
        }
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // `key` already encodes the pairs and source; pairs is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh]);
}
