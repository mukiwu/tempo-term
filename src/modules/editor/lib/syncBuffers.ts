import { useEditorStore } from "@/modules/editor/store/editorStore";
import { openEditorPaths, useTabsStore } from "@/stores/tabsStore";

/**
 * Drop editor buffers whose file is no longer shown in any tab or pane. Closing
 * a file must discard its unsaved edits, otherwise reopening it would resurrect
 * the discarded content instead of reading fresh from disk.
 */
export function pruneEditorBuffers(): void {
  const open = new Set(openEditorPaths(useTabsStore.getState().tabs));
  const editor = useEditorStore.getState();
  for (const path of Object.keys(editor.buffers)) {
    if (!open.has(path)) {
      editor.forget(path);
    }
  }
}

/**
 * Keep editor buffers in step with open tabs for the lifetime of the app: prune
 * orphaned buffers whenever the set of tabs/panes changes (e.g. a tab closes).
 * Returns the unsubscribe handle.
 */
export function installEditorBufferSync(): () => void {
  return useTabsStore.subscribe(() => pruneEditorBuffers());
}
