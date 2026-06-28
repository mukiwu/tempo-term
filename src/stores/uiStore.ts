import { create } from "zustand";

export type SidebarView = "workspaces" | "explorer" | "sourceControl" | "ai" | "notes" | "connections" | "logs";

interface UiState {
  sidebarView: SidebarView;
  sidebarVisible: boolean;
  settingsOpen: boolean;
  terminalOpen: boolean;
  fileFinderOpen: boolean;
  /** Select a sidebar panel and make sure the sidebar is shown. */
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
  sidebarView: "workspaces",
  sidebarVisible: true,
  settingsOpen: false,
  terminalOpen: true,
  fileFinderOpen: false,

  selectSidebar: (view) => set({ sidebarView: view, sidebarVisible: true }),

  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
  setFileFinderOpen: (fileFinderOpen) => set({ fileFinderOpen }),

  openFileFinder: () =>
    set({ sidebarView: "explorer", sidebarVisible: true, fileFinderOpen: true }),
}));
