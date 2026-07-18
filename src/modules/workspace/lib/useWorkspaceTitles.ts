import { useEffect, useMemo } from "react";
import { progressKey, useProgressStore } from "@/modules/claude-progress/lib/progressStore";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import type { AgentKind } from "@/modules/claude-progress/lib/codexNormalize";
import { titleKey, useTitlesStore, type TitleTarget } from "./titlesStore";

/** Caller-facing target: cwd + agent, plus the pane identity when known. The
 *  freshness fingerprint is stamped inside the hook. */
export interface VisibleSession {
  cwd: string;
  agent: AgentKind;
  sessionId?: string;
  leafId?: string;
}

/**
 * Fetches the auto session title for each visible session and refetches one
 * when its freshness fingerprint changes — a new session in its directory, or
 * a title-relevant status transition of any pane contributing to its key.
 *
 * The whole visible set is handed to the store as a single batched call, so:
 *   - sessions whose cached fingerprint already matches are skipped (no IPC)
 *   - successful fetches collapse into one store update, not N re-renders
 * Per-target failures are swallowed by the store.
 */
export function useWorkspaceTitles(targets: VisibleSession[]): void {
  const progressEpochs = useProgressStore((s) => s.sessionEpochs);
  const statusEpochs = useSessionStatusStore((s) => s.statusEpochs);
  const refresh = useTitlesStore((s) => s.refresh);
  const prune = useTitlesStore((s) => s.prune);

  // Group by title key, collecting each contributing pane's status epoch.
  const enriched = useMemo<TitleTarget[]>(() => {
    const byKey = new Map<
      string,
      { cwd: string; agent: AgentKind; sessionId?: string; leafEpochs: Map<string, number> }
    >();
    for (const t of targets) {
      const key = titleKey(t);
      const entry = byKey.get(key) ?? {
        cwd: t.cwd,
        agent: t.agent,
        sessionId: t.sessionId,
        leafEpochs: new Map<string, number>(),
      };
      entry.leafEpochs.set(t.leafId ?? "", t.leafId ? (statusEpochs[t.leafId] ?? 0) : 0);
      byKey.set(key, entry);
    }
    const out: TitleTarget[] = [];
    for (const entry of byKey.values()) {
      const progressEpoch = progressEpochs[progressKey(entry.cwd, entry.agent)] ?? 0;
      // The fingerprint is compared for equality only (see TitleTarget): any
      // change — a bump, a pane joining, leaving, or being swapped for
      // another on a shared legacy key — means one refetch. Epochs of
      // different panes are never ordered against each other; carrying the
      // leaf id keeps an equal-epoch pane swap visible, and sorting just
      // makes the stamp canonical.
      const fingerprint = `${progressEpoch}|${[...entry.leafEpochs.entries()]
        .map(([leafId, epoch]) => `${leafId}:${epoch}`)
        .sort()
        .join(",")}`;
      out.push({
        cwd: entry.cwd,
        agent: entry.agent,
        sessionId: entry.sessionId,
        fingerprint,
      });
    }
    out.sort((a, b) => titleKey(a).localeCompare(titleKey(b)));
    return out;
  }, [targets, progressEpochs, statusEpochs]);

  // Stable string key so the effect only re-fires when the set or a
  // fingerprint changes.
  const depKey = enriched.map((t) => `${titleKey(t)}@${t.fingerprint}`).join("\n");

  useEffect(() => {
    // Session-scoped cache keys are minted per Claude session; drop the ones
    // no longer visible so the cache stays bounded over a long-lived app.
    prune(new Set(enriched.map((t) => titleKey(t))));
    if (enriched.length === 0) {
      return;
    }
    void refresh(enriched);
    // `enriched` is already encoded in depKey; depending on it directly would
    // refetch on every render because WorkspacePanel rebuilds the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, refresh, prune]);
}
