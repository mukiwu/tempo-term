import { useEffect } from "react";
import { useProgressStore } from "@/modules/claude-progress/lib/progressStore";
import { useTitlesStore } from "./titlesStore";

/**
 * Fetches the auto session title for each visible card's cwd, and refetches a
 * cwd when its session epoch changes (a new session starts), so titles track
 * the latest transcript. Failures are swallowed by the store.
 */
export function useWorkspaceTitles(cwds: string[]): void {
  const epochs = useProgressStore((s) => s.sessionEpochs);
  const refresh = useTitlesStore((s) => s.refresh);
  // The key folds in each cwd's epoch so a reset triggers a refetch for it.
  const key = cwds
    .slice()
    .sort()
    .map((cwd) => `${cwd}@${epochs[cwd] ?? 0}`)
    .join("\n");

  useEffect(() => {
    if (!key) {
      return;
    }
    for (const entry of key.split("\n")) {
      const cwd = entry.slice(0, entry.lastIndexOf("@"));
      void refresh(cwd);
    }
  }, [key, refresh]);
}
