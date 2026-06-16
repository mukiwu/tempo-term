import { create } from "zustand";

export type ViewId =
  | "terminal"
  | "explorer"
  | "editor"
  | "sourceControl"
  | "ai"
  | "settings";

interface UiState {
  activeView: ViewId;
  fileFinderOpen: boolean;
  setActiveView: (view: ViewId) => void;
  setFileFinderOpen: (open: boolean) => void;
  /** Jump to the explorer and open the fuzzy file finder (Cmd/Ctrl+P). */
  openFileFinder: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeView: "terminal",
  fileFinderOpen: false,
  setActiveView: (activeView) => set({ activeView }),
  setFileFinderOpen: (fileFinderOpen) => set({ fileFinderOpen }),
  openFileFinder: () => set({ activeView: "explorer", fileFinderOpen: true }),
}));
