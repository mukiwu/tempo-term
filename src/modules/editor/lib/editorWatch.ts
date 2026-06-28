import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { localPreviewFilePaths, openEditorPaths, useTabsStore } from "@/stores/tabsStore";

/**
 * Frontend wrappers around the Rust editor file watcher. The backend watches the
 * given files (by their parent directories) and emits `editor-file-changed` with
 * the affected path whenever one changes on disk, so an open editor tab can
 * reload without the user closing and reopening it.
 */

export function setWatchedEditorFiles(paths: string[]): Promise<void> {
  return invoke("editor_watch_set", { paths });
}

export function onEditorFileChanged(handler: (path: string) => void): Promise<UnlistenFn> {
  return listen<{ path: string }>("editor-file-changed", (event) => handler(event.payload.path));
}

/**
 * Keep the backend watcher's file set in step with the editor tabs that are
 * open: push the current set once, then again whenever tabs/panes change.
 * Returns the unsubscribe handle.
 */
export function installEditorWatchSync(): () => void {
  // The tabs store fires on every change (active tab, pane resize, cwd polls),
  // but the watcher only needs rebuilding when the SET of open files changes.
  // Skip the backend call when the path set is unchanged so dragging a pane
  // resizer doesn't tear down and rebuild the OS watcher dozens of times a second.
  let lastPathsKey = "";
  const sync = () => {
    const tabs = useTabsStore.getState().tabs;
    const paths = Array.from(new Set([...openEditorPaths(tabs), ...localPreviewFilePaths(tabs)])).sort();
    const pathsKey = paths.join("\n");
    if (pathsKey === lastPathsKey) {
      return;
    }
    lastPathsKey = pathsKey;
    void setWatchedEditorFiles(paths).catch(() => {});
  };
  sync();
  return useTabsStore.subscribe(sync);
}
