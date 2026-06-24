import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { perWindowStorage } from "@/lib/window";

export const WORKSPACE_STORAGE_KEY = "tempoterm-workspace";

interface WorkspaceState {
  rootPath: string | null;
  setRoot: (path: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      rootPath: null,
      setRoot: (rootPath) => set({ rootPath }),
    }),
    {
      name: WORKSPACE_STORAGE_KEY,
      storage: createJSONStorage(() => perWindowStorage()),
      // The explorer root is all we persist now; the file in focus is derived
      // from the tabs store (see activeEditorPath), not tracked here.
      partialize: (state) => ({ rootPath: state.rootPath }),
    },
  ),
);
