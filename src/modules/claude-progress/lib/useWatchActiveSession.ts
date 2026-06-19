import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTabsStore } from "@/stores/tabsStore";
import { useProgressStore } from "./progressStore";

/**
 * Streams Claude progress for the active tab's working directory. When the
 * active directory changes we drop the accumulated progress and ask the backend
 * to watch the latest session transcript under that directory. The backend
 * resolves the transcript path and emits appended lines over
 * `claude-progress:lines`, which App listens for.
 */
export function useWatchActiveSession(): void {
  const cwd = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeId)?.cwd);

  useEffect(() => {
    if (!cwd) {
      return;
    }
    useProgressStore.getState().reset();
    void invoke("claude_progress_watch", { cwd }).catch(() => {});
  }, [cwd]);
}
