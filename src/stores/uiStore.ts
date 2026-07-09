import { create } from "zustand";

export type SidebarView = "workspaces" | "explorer" | "sourceControl" | "ai" | "notes" | "connections" | "sessions";

/** The full set of sidebar panels in their default left-to-right order. */
export const DEFAULT_SIDEBAR_ORDER: SidebarView[] = [
  "workspaces",
  "explorer",
  "sourceControl",
  "notes",
  "ai",
  "connections",
  "sessions",
];

// Follows the repo's `tempoterm-` localStorage key convention (see the
// git-graph module), not the older `tempo.` form.
const SIDEBAR_ORDER_STORAGE_KEY = "tempoterm-sidebar-order";

/**
 * Read the persisted icon-bar order from localStorage, dropping unknown ids and
 * appending any panels that were added since the order was saved. This keeps the
 * user's arrangement stable across releases even when new panels ship. Exported
 * for unit tests.
 */
export function loadSidebarOrder(): SidebarView[] {
  try {
    const raw = localStorage.getItem(SIDEBAR_ORDER_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SIDEBAR_ORDER;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return DEFAULT_SIDEBAR_ORDER;
    }
    const known = new Set<SidebarView>(DEFAULT_SIDEBAR_ORDER);
    const seen = new Set<SidebarView>();
    const order: SidebarView[] = [];
    for (const id of parsed) {
      if (known.has(id as SidebarView) && !seen.has(id as SidebarView)) {
        seen.add(id as SidebarView);
        order.push(id as SidebarView);
      }
    }
    for (const id of DEFAULT_SIDEBAR_ORDER) {
      if (!seen.has(id)) {
        order.push(id);
      }
    }
    return order;
  } catch {
    return DEFAULT_SIDEBAR_ORDER;
  }
}

function saveSidebarOrder(order: SidebarView[]): void {
  try {
    localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Persistence is best-effort; a full or blocked localStorage is non-fatal.
  }
}

interface UiState {
  sidebarView: SidebarView;
  /** Icon-bar order, drag-reorderable and persisted to localStorage. */
  sidebarOrder: SidebarView[];
  sidebarVisible: boolean;
  settingsOpen: boolean;
  /** Which settings section to land on when the modal opens (e.g. "about",
   *  "shortcuts"), or null to open on the default section. Set by
   *  `openSettings` from the menu bar / File > Settings; consumed by the
   *  settings modal to pre-select its tab. */
  settingsSection: string | null;
  /** First-run setup wizard visibility. Opened automatically on first launch and
   *  re-openable from the File menu or the Settings About tab. */
  setupWizardOpen: boolean;
  terminalOpen: boolean;
  fileFinderOpen: boolean;
  portsPanelOpen: boolean;
  /**
   * Number of full-screen overlays (modals, dialogs, context menus) currently
   * mounted. The native preview webview floats above all DOM, so it must hide
   * itself whenever an overlay is open. Tracked as a counter because several
   * overlays can stack. See useOverlayGuard in src/lib/overlayGuard.ts.
   */
  overlayCount: number;
  /** Select a sidebar panel and make sure the sidebar is shown. */
  selectSidebar: (view: SidebarView) => void;
  /** Move an icon from one position to another in the icon bar. */
  reorderSidebar: (from: number, to: number) => void;
  toggleSidebar: () => void;
  setSettingsOpen: (open: boolean) => void;
  /** Open the settings modal, optionally jumping straight to a section. */
  openSettings: (section?: string) => void;
  setSetupWizardOpen: (open: boolean) => void;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setFileFinderOpen: (open: boolean) => void;
  setPortsPanelOpen: (open: boolean) => void;
  togglePortsPanel: () => void;
  /** Open the global fuzzy file search palette (Cmd/Ctrl+P). Independent of
   *  the sidebar — it renders as a top-anchored overlay regardless of which
   *  sidebar panel (if any) is currently showing. */
  openFileFinder: () => void;
  pushOverlay: () => void;
  popOverlay: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarView: "workspaces",
  sidebarOrder: loadSidebarOrder(),
  sidebarVisible: true,
  settingsOpen: false,
  settingsSection: null,
  setupWizardOpen: false,
  terminalOpen: true,
  fileFinderOpen: false,
  portsPanelOpen: false,
  overlayCount: 0,

  selectSidebar: (view) => set({ sidebarView: view, sidebarVisible: true }),

  reorderSidebar: (from, to) =>
    set((state) => {
      const order = [...state.sidebarOrder];
      if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) {
        return {};
      }
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      saveSidebarOrder(order);
      return { sidebarOrder: order };
    }),

  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  openSettings: (section) => set({ settingsOpen: true, settingsSection: section ?? null }),
  setSetupWizardOpen: (setupWizardOpen) => set({ setupWizardOpen }),
  setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
  setFileFinderOpen: (fileFinderOpen) => set({ fileFinderOpen }),
  setPortsPanelOpen: (portsPanelOpen) => set({ portsPanelOpen }),
  togglePortsPanel: () => set((state) => ({ portsPanelOpen: !state.portsPanelOpen })),

  openFileFinder: () => set({ fileFinderOpen: true }),

  pushOverlay: () => set((state) => ({ overlayCount: state.overlayCount + 1 })),
  popOverlay: () => set((state) => ({ overlayCount: Math.max(0, state.overlayCount - 1) })),
}));

/** True when any full-screen overlay is mounted over the workspace. */
export const selectAnyOverlayOpen = (state: UiState): boolean => state.overlayCount > 0;
