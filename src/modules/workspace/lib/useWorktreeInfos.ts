import { useEffect } from "react";
import { useWorktreeStore } from "./worktreeStore";

/**
 * Keeps the worktree-info cache in sync with the directories currently shown as
 * cards: fetches whenever the cwd set changes and refetches when the window
 * regains focus (branches/worktrees can change while the app is in the
 * background). Fetch failures are swallowed by the store.
 */
export function useWorktreeInfos(cwds: string[]): void {
  const refresh = useWorktreeStore((s) => s.refresh);
  // A stable key so the effect only re-runs when the cwd set actually changes.
  const key = cwds.slice().sort().join("\n");

  useEffect(() => {
    const list = key ? key.split("\n") : [];
    if (list.length === 0) {
      return;
    }
    void refresh(list);
    const onFocus = () => void refresh(list);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [key, refresh]);
}
