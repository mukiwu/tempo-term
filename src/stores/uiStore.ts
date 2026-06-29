import { create } from "zustand";

export type SidebarView = "workspaces" | "explorer" | "sourceControl" | "ai" | "notes" | "connections" | "logs";

interface UiState {
  sidebarView: SidebarView;
  sidebarVisible: boolean;
  settingsOpen: boolean;
  terminalOpen: boolean;
  fileFinderOpen: boolean;
  portsPanelOpen: boolean;
  /** Select a sidebar panel and make sure the sidebar is shown. */
  selectSidebar: (view: SidebarView) => void;
  toggleSidebar: () => void;
  setSettingsOpen: (open: boolean) => void;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setFileFinderOpen: (open: boolean) => void;
  setPortsPanelOpen: (open: boolean) => void;
  togglePortsPanel: () => void;
  /** Reveal the explorer and open the fuzzy file finder (Cmd/Ctrl+P). */
  openFileFinder: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarView: "workspaces",
  sidebarVisible: true,
  settingsOpen: false,
  terminalOpen: true,
  fileFinderOpen: false,
  portsPanelOpen: false,

  selectSidebar: (view) => set({ sidebarView: view, sidebarVisible: true }),

  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
  setFileFinderOpen: (fileFinderOpen) => set({ fileFinderOpen }),
  setPortsPanelOpen: (portsPanelOpen) => set({ portsPanelOpen }),
  togglePortsPanel: () => set((state) => ({ portsPanelOpen: !state.portsPanelOpen })),

  openFileFinder: () =>
    set({ sidebarView: "explorer", sidebarVisible: true, fileFinderOpen: true }),
}));
