import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { perWindowStorage } from "@/lib/window";
import {
  forgetDir,
  forgetRoot,
  isDirRemembered,
  rememberDir,
  type ExpandedDirs,
} from "@/modules/explorer/lib/expandedDirs";

export const EXPLORER_STORAGE_KEY = "tempoterm-explorer";

interface ExplorerState {
  /** Expanded folder paths, keyed by the workspace root they belong to. */
  expandedDirs: ExpandedDirs;
  /** Whether `path` should mount expanded. Read once per TreeNode, on mount. */
  isDirExpanded: (root: string | null, path: string) => boolean;
  setDirExpanded: (root: string | null, path: string, expanded: boolean) => void;
  /** Forgets a whole root: collapse-all and refresh both start from scratch. */
  clearRoot: (root: string | null) => void;
}

/**
 * Remembers which folders the file explorer had open so the tree survives a
 * tab switch. Switching to a tab on another project re-roots the explorer,
 * which unmounts every TreeNode; without this the tree came back fully
 * collapsed every time.
 */
export const useExplorerStore = create<ExplorerState>()(
  persist(
    (set, get) => ({
      expandedDirs: {},

      isDirExpanded: (root, path) => isDirRemembered(get().expandedDirs, root, path),

      setDirExpanded: (root, path, expanded) =>
        set((state) => {
          const next = expanded
            ? rememberDir(state.expandedDirs, root, path)
            : forgetDir(state.expandedDirs, root, path);
          return next === state.expandedDirs ? state : { expandedDirs: next };
        }),

      clearRoot: (root) =>
        set((state) => {
          const next = forgetRoot(state.expandedDirs, root);
          return next === state.expandedDirs ? state : { expandedDirs: next };
        }),
    }),
    {
      name: EXPLORER_STORAGE_KEY,
      storage: createJSONStorage(() => perWindowStorage()),
      partialize: (state) => ({ expandedDirs: state.expandedDirs }),
    },
  ),
);
