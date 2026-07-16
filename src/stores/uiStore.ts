import { create } from "zustand";

// Legacy flat sidebar-order key, kept only so loadDockLayout can migrate a
// pre-three-column arrangement. Follows the repo's `tempoterm-` key convention.
const SIDEBAR_ORDER_STORAGE_KEY = "tempoterm-sidebar-order";

// ─────────────────────────────────────────────────────────────────────────────
// Three-column dock layout
//
// Each dockable panel lives on exactly one side (left or right). `panelOrder`
// is the source of truth for placement + icon-strip order; `panelDock` is
// derived from it for O(1) side lookups. The layout persists globally to
// localStorage (shared across windows, like the legacy sidebar order) via a
// manual load/save, matching this store's existing style.
// ─────────────────────────────────────────────────────────────────────────────

/** Every dockable panel. The legacy seven sidebar views plus `ports`. */
export const PANEL_IDS = [
  "workspaces",
  "explorer",
  "sourceControl",
  "notes",
  "ai",
  "connections",
  "sessions",
  "ports",
] as const;
export type PanelId = (typeof PANEL_IDS)[number];
export type DockSide = "left" | "right";

/** Per-side column width bounds, in px. Center-min protection lives in the
 *  layout layer (it needs the container width, which the store doesn't know). */
export const MIN_COL = 180;
export const MAX_COL = 640;

const DOCK_STORAGE_KEY = "tempoterm-dock-layout";

export interface DockLayout {
  /** Which side each panel lives on. Derived from `panelOrder`; one entry per panel. */
  panelDock: Record<PanelId, DockSide>;
  /** Ordered panel ids per side (icon-strip order). Their union is all PANEL_IDS. */
  panelOrder: Record<DockSide, PanelId[]>;
  /** The active (body-visible) panel per side, or null when a side has no panels. */
  activePanel: Record<DockSide, PanelId | null>;
  /** Column width per side, px, clamped to [MIN_COL, MAX_COL]. */
  width: Record<DockSide, number>;
  /** Column visibility per side (⌘B toggles left, ⌘⌥B toggles right). */
  visible: Record<DockSide, boolean>;
}

const DEFAULT_LEFT: PanelId[] = ["workspaces", "connections", "notes", "sessions"];
const DEFAULT_RIGHT: PanelId[] = ["explorer", "sourceControl", "ai", "ports"];

function deriveDock(left: PanelId[], right: PanelId[]): Record<PanelId, DockSide> {
  const dock = {} as Record<PanelId, DockSide>;
  for (const id of left) dock[id] = "left";
  for (const id of right) dock[id] = "right";
  return dock;
}

export const DEFAULT_DOCK: DockLayout = {
  panelDock: deriveDock(DEFAULT_LEFT, DEFAULT_RIGHT),
  panelOrder: { left: [...DEFAULT_LEFT], right: [...DEFAULT_RIGHT] },
  activePanel: { left: DEFAULT_LEFT[0], right: DEFAULT_RIGHT[0] },
  width: { left: 260, right: 300 },
  visible: { left: true, right: true },
};

function clampWidth(px: unknown, fallback: number): number {
  const n = typeof px === "number" && Number.isFinite(px) ? px : fallback;
  return Math.min(MAX_COL, Math.max(MIN_COL, Math.round(n)));
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/**
 * Coerce an arbitrary (possibly partial or stale) layout into a valid one:
 * every panel present exactly once, honoring stored placement; panels missing
 * from storage (e.g. a newly-shipped one) fall to their default side; invalid
 * active panels repair to the side's first panel; widths clamp.
 */
function normalizeDockLayout(partial: Partial<DockLayout>): DockLayout {
  const known = new Set<PanelId>(PANEL_IDS);
  const seen = new Set<PanelId>();
  const left: PanelId[] = [];
  const right: PanelId[] = [];
  const take = (arr: unknown, dest: PanelId[]) => {
    if (!Array.isArray(arr)) return;
    for (const id of arr) {
      if (known.has(id as PanelId) && !seen.has(id as PanelId)) {
        seen.add(id as PanelId);
        dest.push(id as PanelId);
      }
    }
  };
  take(partial.panelOrder?.left, left);
  take(partial.panelOrder?.right, right);
  // Append panels not present in storage to their default side, in default order.
  for (const id of DEFAULT_LEFT) if (!seen.has(id)) (seen.add(id), left.push(id));
  for (const id of DEFAULT_RIGHT) if (!seen.has(id)) (seen.add(id), right.push(id));

  const panelOrder: Record<DockSide, PanelId[]> = { left, right };
  const activeFor = (side: DockSide): PanelId | null => {
    const cand = partial.activePanel?.[side];
    if (cand && panelOrder[side].includes(cand)) return cand;
    return panelOrder[side][0] ?? null;
  };

  return {
    panelDock: deriveDock(left, right),
    panelOrder,
    activePanel: { left: activeFor("left"), right: activeFor("right") },
    width: {
      left: clampWidth(partial.width?.left, DEFAULT_DOCK.width.left),
      right: clampWidth(partial.width?.right, DEFAULT_DOCK.width.right),
    },
    visible: {
      left: typeof partial.visible?.left === "boolean" ? partial.visible.left : true,
      right: typeof partial.visible?.right === "boolean" ? partial.visible.right : true,
    },
  };
}

/** One-time migration: seed the two-sided layout from the legacy flat sidebar
 *  order, ordering each side's default members by their position in the legacy
 *  array so the user's relative arrangement carries over. */
function migrateFromLegacy(legacy: unknown[]): DockLayout {
  const idx = new Map<PanelId, number>();
  legacy.forEach((id, i) => {
    if ((PANEL_IDS as readonly string[]).includes(id as string) && !idx.has(id as PanelId)) {
      idx.set(id as PanelId, i);
    }
  });
  // Absent panels sort after present ones, keeping their default relative order.
  const pos = (id: PanelId) => (idx.has(id) ? (idx.get(id) as number) : 1e9 + PANEL_IDS.indexOf(id));
  const orderSide = (members: PanelId[]) => [...members].sort((a, b) => pos(a) - pos(b));
  return normalizeDockLayout({
    panelOrder: { left: orderSide(DEFAULT_LEFT), right: orderSide(DEFAULT_RIGHT) },
  });
}

/** Load the dock layout: prefer the new key, else migrate the legacy sidebar
 *  order, else defaults. Never mutates localStorage (the legacy key stays intact
 *  so the old sidebar keeps working during the transition). Exported for tests. */
export function loadDockLayout(): DockLayout {
  const stored = readJson(DOCK_STORAGE_KEY);
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    return normalizeDockLayout(stored as Partial<DockLayout>);
  }
  const legacy = readJson(SIDEBAR_ORDER_STORAGE_KEY);
  if (Array.isArray(legacy)) {
    return migrateFromLegacy(legacy);
  }
  return normalizeDockLayout({});
}

function persistDock(
  layout: Pick<DockLayout, "panelOrder" | "activePanel" | "width" | "visible">,
): void {
  try {
    localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        panelOrder: layout.panelOrder,
        activePanel: layout.activePanel,
        width: layout.width,
        visible: layout.visible,
      }),
    );
  } catch {
    // Persistence is best-effort; a full or blocked localStorage is non-fatal.
  }
}

interface UiState {
  // ── Three-column dock layout ──
  panelDock: Record<PanelId, DockSide>;
  panelOrder: Record<DockSide, PanelId[]>;
  activePanel: Record<DockSide, PanelId | null>;
  width: Record<DockSide, number>;
  visible: Record<DockSide, boolean>;
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
  /**
   * Number of full-screen overlays (modals, dialogs, context menus) currently
   * mounted. The native preview webview floats above all DOM, so it must hide
   * itself whenever an overlay is open. Tracked as a counter because several
   * overlays can stack. See useOverlayGuard in src/lib/overlayGuard.ts.
   */
  overlayCount: number;
  // ── Dock actions ──
  /** Activate a panel: reveal its docked side and make it the active panel there. */
  activatePanel: (id: PanelId) => void;
  /** Toggle one column's visibility (⌘B left / ⌘⌥B right). */
  toggleSide: (side: DockSide) => void;
  /** Set a column's width (clamped to [MIN_COL, MAX_COL]). */
  setSideWidth: (side: DockSide, px: number) => void;
  /** Re-dock a panel to `toSide` at `toIndex`, repairing active panels. */
  movePanel: (id: PanelId, toSide: DockSide, toIndex: number) => void;
  /** Reorder a panel within its own side without changing the active panel. */
  reorderWithinSide: (side: DockSide, from: number, to: number) => void;
  setSettingsOpen: (open: boolean) => void;
  /** Open the settings modal, optionally jumping straight to a section. */
  openSettings: (section?: string) => void;
  setSetupWizardOpen: (open: boolean) => void;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setFileFinderOpen: (open: boolean) => void;
  /** Open the global fuzzy file search palette (Cmd/Ctrl+P). Independent of
   *  the sidebar — it renders as a top-anchored overlay regardless of which
   *  sidebar panel (if any) is currently showing. */
  openFileFinder: () => void;
  pushOverlay: () => void;
  popOverlay: () => void;
}

export const useUiStore = create<UiState>((set) => {
  const dock = loadDockLayout();
  return {
    panelDock: dock.panelDock,
    panelOrder: dock.panelOrder,
    activePanel: dock.activePanel,
    width: dock.width,
    visible: dock.visible,
    settingsOpen: false,
    settingsSection: null,
    setupWizardOpen: false,
    terminalOpen: true,
    fileFinderOpen: false,
    overlayCount: 0,

    activatePanel: (id) =>
      set((state) => {
        const side = state.panelDock[id];
        const activePanel = { ...state.activePanel, [side]: id };
        const visible = { ...state.visible, [side]: true };
        persistDock({ panelOrder: state.panelOrder, activePanel, width: state.width, visible });
        return { activePanel, visible };
      }),

    toggleSide: (side) =>
      set((state) => {
        const visible = { ...state.visible, [side]: !state.visible[side] };
        persistDock({ panelOrder: state.panelOrder, activePanel: state.activePanel, width: state.width, visible });
        return { visible };
      }),

    setSideWidth: (side, px) =>
      set((state) => {
        const width = { ...state.width, [side]: clampWidth(px, state.width[side]) };
        persistDock({ panelOrder: state.panelOrder, activePanel: state.activePanel, width, visible: state.visible });
        return { width };
      }),

    movePanel: (id, toSide, toIndex) =>
      set((state) => {
        const fromSide = state.panelDock[id];
        const left = state.panelOrder.left.filter((x) => x !== id);
        const right = state.panelOrder.right.filter((x) => x !== id);
        const target = toSide === "left" ? left : right;
        const at = Math.max(0, Math.min(toIndex, target.length));
        target.splice(at, 0, id);
        const panelOrder: Record<DockSide, PanelId[]> = { left, right };
        const activePanel = { ...state.activePanel, [toSide]: id };
        if (fromSide !== toSide && state.activePanel[fromSide] === id) {
          activePanel[fromSide] = panelOrder[fromSide][0] ?? null;
        }
        const visible = { ...state.visible, [toSide]: true };
        persistDock({ panelOrder, activePanel, width: state.width, visible });
        return { panelOrder, panelDock: deriveDock(left, right), activePanel, visible };
      }),

    reorderWithinSide: (side, from, to) =>
      set((state) => {
        const order = [...state.panelOrder[side]];
        if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) {
          return {};
        }
        const [moved] = order.splice(from, 1);
        order.splice(to, 0, moved);
        const panelOrder = { ...state.panelOrder, [side]: order };
        persistDock({ panelOrder, activePanel: state.activePanel, width: state.width, visible: state.visible });
        return { panelOrder };
      }),

    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    openSettings: (section) => set({ settingsOpen: true, settingsSection: section ?? null }),
    setSetupWizardOpen: (setupWizardOpen) => set({ setupWizardOpen }),
    setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
    toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
    setFileFinderOpen: (fileFinderOpen) => set({ fileFinderOpen }),

    openFileFinder: () => set({ fileFinderOpen: true }),

    pushOverlay: () => set((state) => ({ overlayCount: state.overlayCount + 1 })),
    popOverlay: () => set((state) => ({ overlayCount: Math.max(0, state.overlayCount - 1) })),
  };
});

/** True when any full-screen overlay is mounted over the workspace. */
export const selectAnyOverlayOpen = (state: UiState): boolean => state.overlayCount > 0;
