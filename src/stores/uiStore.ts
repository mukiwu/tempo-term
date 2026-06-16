import { create } from "zustand";

export type SidebarView = "explorer" | "sourceControl" | "ai" | "notes";

interface UiState {
  sidebarView: SidebarView;
  sidebarVisible: boolean;
  settingsOpen: boolean;
  terminalOpen: boolean;
  fileFinderOpen: boolean;
  /** Select a sidebar panel; clicking the active one toggles the sidebar. */
  selectSidebar: (view: SidebarView) => void;
  toggleSidebar: () => void;
  setSettingsOpen: (open: boolean) => void;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setFileFinderOpen: (open: boolean) => void;
  /** Reveal the explorer and open the fuzzy file finder (Cmd/Ctrl+P). */
  openFileFinder: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarView: "explorer",
  sidebarVisible: true,
  settingsOpen: false,
  terminalOpen: true,
  fileFinderOpen: false,

  selectSidebar: (view) =>
    set((state) => {
      if (state.sidebarView === view && state.sidebarVisible) {
        return { sidebarVisible: false };
      }
      return { sidebarView: view, sidebarVisible: true };
    }),

  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
  setFileFinderOpen: (fileFinderOpen) => set({ fileFinderOpen }),

  openFileFinder: () =>
    set({ sidebarView: "explorer", sidebarVisible: true, fileFinderOpen: true }),
}));
