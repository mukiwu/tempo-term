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
  setActiveView: (view: ViewId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeView: "terminal",
  setActiveView: (activeView) => set({ activeView }),
}));
