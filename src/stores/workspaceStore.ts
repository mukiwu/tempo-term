import { create } from "zustand";

interface WorkspaceState {
  rootPath: string | null;
  openFiles: string[];
  activeFile: string | null;
  setRoot: (path: string) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  rootPath: null,
  openFiles: [],
  activeFile: null,

  setRoot: (rootPath) => set({ rootPath }),

  openFile: (path) =>
    set((state) => ({
      openFiles: state.openFiles.includes(path)
        ? state.openFiles
        : [...state.openFiles, path],
      activeFile: path,
    })),

  closeFile: (path) =>
    set((state) => {
      const index = state.openFiles.indexOf(path);
      if (index === -1) {
        return state;
      }
      const openFiles = state.openFiles.filter((p) => p !== path);
      let activeFile = state.activeFile;
      if (state.activeFile === path) {
        const neighbour = openFiles[index - 1] ?? openFiles[index] ?? null;
        activeFile = neighbour ?? null;
      }
      return { openFiles, activeFile };
    }),

  setActiveFile: (activeFile) => set({ activeFile }),
}));
