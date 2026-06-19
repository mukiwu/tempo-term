import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTabsStore, type Tab } from "@/stores/tabsStore";
import { findPaneContent, leafIds } from "@/modules/terminal/lib/terminalLayout";
import { useProgressStore } from "./progressStore";

/** Every distinct working directory that has an open terminal pane. */
function collectTerminalCwds(tabs: Tab[]): string[] {
  const cwds = new Set<string>();
  for (const tab of tabs) {
    for (const id of leafIds(tab.paneTree)) {
      const pane = findPaneContent(tab.paneTree, id);
      if (pane?.kind === "terminal" && pane.cwd) {
        cwds.add(pane.cwd);
      }
    }
  }
  return [...cwds];
}

/**
 * Streams Claude progress for every open terminal pane's directory. Whenever the
 * set of terminal cwds changes we drop progress for directories that are gone and
 * ask the backend to watch the current set; the backend follows each directory's
 * latest session and emits `claude-progress:lines` tagged with its cwd.
 */
export function useWatchSessions(): void {
  // A stable string key so the effect only re-runs when the cwd set changes.
  const cwdKey = useTabsStore((s) => collectTerminalCwds(s.tabs).sort().join("\n"));

  useEffect(() => {
    const cwds = cwdKey ? cwdKey.split("\n") : [];
    useProgressStore.getState().syncSessions(cwds);
    void invoke("claude_progress_watch", { cwds }).catch(() => {});
  }, [cwdKey]);
}
