import { useEffect, useRef } from "react";
import { useWorktreeStore } from "@/modules/workspace/lib/worktreeStore";
import { useWorktreesStore } from "./worktreesStore";

/**
 * Learn which repos have worktrees, for free.
 *
 * The workspace cards already ask `git_worktree_info` for every open terminal's
 * cwd, and that answer carries the repo's main path — so discovering a repo
 * costs no extra IPC. This watches that cache and scans each newly-seen repo
 * exactly once; the scan is what decides whether the repo is worth registering,
 * since only repos that actually have a linked worktree belong there.
 *
 * Without this the registry could only ever be filled by opening the manager,
 * which is reachable only from a badge that hides itself while the registry is
 * empty — a feature that could never appear.
 *
 * Fires when a repo first becomes visible: an event, not a timer.
 */
export function useWorktreeDiscovery(): void {
  const infos = useWorktreeStore((s) => s.infos);
  const refresh = useWorktreesStore((s) => s.refresh);
  const scanned = useRef(new Set<string>());

  useEffect(() => {
    for (const info of Object.values(infos)) {
      // A linked worktree reports its main path; a plain repo is its own root.
      const repoPath = info.isWorktree ? info.mainPath : info.cwd;
      if (!repoPath || scanned.current.has(repoPath)) {
        continue;
      }
      scanned.current.add(repoPath);
      void refresh(repoPath).catch(() => {
        // Gone, or git was busy. The store decides whether to drop it; let this
        // repo be tried again the next time it shows up.
        scanned.current.delete(repoPath);
      });
    }
  }, [infos, refresh]);
}
