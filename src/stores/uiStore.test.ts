import { beforeEach, describe, expect, it } from "vitest";
import {
  useUiStore,
  selectAnyOverlayOpen,
  loadSidebarOrder,
  DEFAULT_SIDEBAR_ORDER,
  PANEL_IDS,
  DEFAULT_DOCK,
  loadDockLayout,
  MIN_COL,
  MAX_COL,
} from "./uiStore";

const STORAGE_KEY = "tempoterm-sidebar-order";
const DOCK_KEY = "tempoterm-dock-layout";

function cloneDefaultDock() {
  return {
    panelDock: { ...DEFAULT_DOCK.panelDock },
    panelOrder: {
      left: [...DEFAULT_DOCK.panelOrder.left],
      right: [...DEFAULT_DOCK.panelOrder.right],
    },
    activePanel: { ...DEFAULT_DOCK.activePanel },
    width: { ...DEFAULT_DOCK.width },
    visible: { ...DEFAULT_DOCK.visible },
  };
}

beforeEach(() =>
  useUiStore.setState({ sidebarView: "explorer", sidebarVisible: false, overlayCount: 0 }),
);

describe("uiStore workspaces view", () => {
  it("selects the workspaces view and reveals the sidebar", () => {
    useUiStore.getState().selectSidebar("workspaces");
    expect(useUiStore.getState().sidebarView).toBe("workspaces");
    expect(useUiStore.getState().sidebarVisible).toBe(true);
  });
});

describe("uiStore openFileFinder", () => {
  it("opens the global file search without touching the sidebar", () => {
    useUiStore.setState({ sidebarView: "notes", sidebarVisible: false, fileFinderOpen: false });

    useUiStore.getState().openFileFinder();

    const state = useUiStore.getState();
    expect(state.fileFinderOpen).toBe(true);
    expect(state.sidebarView).toBe("notes");
    expect(state.sidebarVisible).toBe(false);
  });
});

describe("uiStore overlay counter", () => {
  it("reports an overlay open while the count is positive", () => {
    expect(selectAnyOverlayOpen(useUiStore.getState())).toBe(false);
    useUiStore.getState().pushOverlay();
    expect(selectAnyOverlayOpen(useUiStore.getState())).toBe(true);
  });

  it("tracks stacked overlays and only clears at zero", () => {
    const { pushOverlay, popOverlay } = useUiStore.getState();
    pushOverlay();
    pushOverlay();
    popOverlay();
    expect(selectAnyOverlayOpen(useUiStore.getState())).toBe(true);
    popOverlay();
    expect(selectAnyOverlayOpen(useUiStore.getState())).toBe(false);
  });

  it("never drops below zero", () => {
    useUiStore.getState().popOverlay();
    expect(useUiStore.getState().overlayCount).toBe(0);
  });
});

describe("loadSidebarOrder", () => {
  beforeEach(() => localStorage.clear());

  it("returns the default order when nothing is stored", () => {
    expect(loadSidebarOrder()).toEqual(DEFAULT_SIDEBAR_ORDER);
  });

  it("falls back to the default order on non-array or malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, '{"not":"an array"}');
    expect(loadSidebarOrder()).toEqual(DEFAULT_SIDEBAR_ORDER);
    localStorage.setItem(STORAGE_KEY, "not json at all");
    expect(loadSidebarOrder()).toEqual(DEFAULT_SIDEBAR_ORDER);
  });

  it("honors a saved arrangement", () => {
    const saved = ["ai", "explorer", "workspaces", "sourceControl", "notes", "connections", "sessions"];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    expect(loadSidebarOrder()).toEqual(saved);
  });

  it("drops unknown ids and de-duplicates, keeping first occurrence", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["ai", "bogus", "ai", "explorer", 42, "explorer"]),
    );
    // Known+unique prefix preserved (ai, explorer), then the remaining default
    // panels appended in default order.
    expect(loadSidebarOrder()).toEqual([
      "ai",
      "explorer",
      "workspaces",
      "sourceControl",
      "notes",
      "connections",
      "sessions",
    ]);
  });

  it("appends panels added since the order was saved", () => {
    // An older save that predates the "sessions" panel keeps its arrangement,
    // with the new panel appended rather than lost.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["explorer", "workspaces", "sourceControl", "notes", "ai", "connections"]),
    );
    expect(loadSidebarOrder()).toEqual([
      "explorer",
      "workspaces",
      "sourceControl",
      "notes",
      "ai",
      "connections",
      "sessions",
    ]);
  });
});

describe("DEFAULT_DOCK", () => {
  it("places every panel exactly once across the two sides", () => {
    const all = [...DEFAULT_DOCK.panelOrder.left, ...DEFAULT_DOCK.panelOrder.right];
    expect([...all].sort()).toEqual([...PANEL_IDS].sort());
    expect(new Set(all).size).toBe(PANEL_IDS.length);
  });

  it("uses the agreed default split and actives", () => {
    expect(DEFAULT_DOCK.panelOrder.left).toEqual(["workspaces", "connections", "notes", "sessions"]);
    expect(DEFAULT_DOCK.panelOrder.right).toEqual(["explorer", "sourceControl", "ai", "ports"]);
    expect(DEFAULT_DOCK.activePanel).toEqual({ left: "workspaces", right: "explorer" });
  });

  it("keeps panelDock in agreement with panelOrder", () => {
    expect(DEFAULT_DOCK.panelDock.workspaces).toBe("left");
    expect(DEFAULT_DOCK.panelDock.notes).toBe("left");
    expect(DEFAULT_DOCK.panelDock.explorer).toBe("right");
    expect(DEFAULT_DOCK.panelDock.ports).toBe("right");
  });
});

describe("loadDockLayout", () => {
  beforeEach(() => localStorage.clear());

  it("returns the default layout when nothing is stored", () => {
    expect(loadDockLayout()).toEqual(DEFAULT_DOCK);
  });

  it("adds a newly-shipped panel to its default side (normalization)", () => {
    // A stored layout that predates the `ports` panel.
    localStorage.setItem(
      DOCK_KEY,
      JSON.stringify({
        panelOrder: {
          left: ["workspaces", "connections", "notes", "sessions"],
          right: ["explorer", "sourceControl", "ai"],
        },
        activePanel: { left: "workspaces", right: "explorer" },
        width: { left: 260, right: 300 },
        visible: { left: true, right: true },
      }),
    );
    const dock = loadDockLayout();
    expect(dock.panelOrder.right).toContain("ports");
    expect(dock.panelDock.ports).toBe("right");
  });

  it("respects a stored placement even when it differs from the default side", () => {
    localStorage.setItem(
      DOCK_KEY,
      JSON.stringify({
        panelOrder: {
          left: ["workspaces", "explorer"], // explorer moved to the left
          right: ["connections", "notes", "sessions", "sourceControl", "ai", "ports"],
        },
      }),
    );
    const dock = loadDockLayout();
    expect(dock.panelDock.explorer).toBe("left");
    expect(dock.panelOrder.left).toContain("explorer");
    expect(dock.panelOrder.right).not.toContain("explorer");
  });

  it("repairs an invalid active panel to the side's first panel", () => {
    localStorage.setItem(
      DOCK_KEY,
      JSON.stringify({
        panelOrder: {
          left: ["workspaces", "connections", "notes", "sessions"],
          right: ["explorer", "sourceControl", "ai", "ports"],
        },
        activePanel: { left: "explorer", right: null }, // explorer isn't on the left
        width: { left: 260, right: 300 },
        visible: { left: true, right: true },
      }),
    );
    const dock = loadDockLayout();
    expect(dock.activePanel.left).toBe("workspaces");
    expect(dock.activePanel.right).toBe("explorer");
  });

  it("clamps out-of-range widths", () => {
    localStorage.setItem(
      DOCK_KEY,
      JSON.stringify({
        panelOrder: DEFAULT_DOCK.panelOrder,
        activePanel: DEFAULT_DOCK.activePanel,
        width: { left: 20, right: 5000 },
        visible: { left: true, right: true },
      }),
    );
    const dock = loadDockLayout();
    expect(dock.width.left).toBe(MIN_COL);
    expect(dock.width.right).toBe(MAX_COL);
  });

  it("migrates a legacy sidebar order, preserving relative order within each side", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["ai", "explorer", "workspaces", "sourceControl", "notes", "connections", "sessions"]),
    );
    const dock = loadDockLayout();
    // Left members ordered by their legacy index: workspaces(2), notes(4), connections(5), sessions(6).
    expect(dock.panelOrder.left).toEqual(["workspaces", "notes", "connections", "sessions"]);
    // Right members: ai(0), explorer(1), sourceControl(3), then ports (new) appended.
    expect(dock.panelOrder.right).toEqual(["ai", "explorer", "sourceControl", "ports"]);
  });

  it("does not delete the legacy key during migration (old UI still reads it)", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...DEFAULT_SIDEBAR_ORDER]));
    loadDockLayout();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});

describe("uiStore dock actions", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState(cloneDefaultDock());
  });

  it("activatePanel reveals the panel's docked side and activates it", () => {
    useUiStore.setState({ visible: { left: true, right: false } });
    useUiStore.getState().activatePanel("ai"); // ai defaults to the right
    const s = useUiStore.getState();
    expect(s.activePanel.right).toBe("ai");
    expect(s.visible.right).toBe(true);
  });

  it("toggleSide flips one side independently", () => {
    useUiStore.getState().toggleSide("right");
    expect(useUiStore.getState().visible).toEqual({ left: true, right: false });
    useUiStore.getState().toggleSide("left");
    expect(useUiStore.getState().visible).toEqual({ left: false, right: false });
  });

  it("setSideWidth clamps and persists", () => {
    useUiStore.getState().setSideWidth("left", 10000);
    expect(useUiStore.getState().width.left).toBe(MAX_COL);
    expect(loadDockLayout().width.left).toBe(MAX_COL);
  });

  it("movePanel moves a panel across sides, repairs actives, and updates dock", () => {
    // explorer starts on the right and is the right side's active panel.
    useUiStore.getState().movePanel("explorer", "left", 0);
    const s = useUiStore.getState();
    expect(s.panelOrder.left[0]).toBe("explorer");
    expect(s.panelOrder.right).not.toContain("explorer");
    expect(s.panelDock.explorer).toBe("left");
    expect(s.activePanel.left).toBe("explorer"); // target side active = the moved panel
    expect(s.activePanel.right).toBe("sourceControl"); // right's new first panel
  });

  it("movePanel within the same side reorders and keeps the dock side", () => {
    useUiStore.getState().movePanel("sessions", "left", 0); // sessions (last) → front of left
    expect(useUiStore.getState().panelOrder.left[0]).toBe("sessions");
    expect(useUiStore.getState().panelDock.sessions).toBe("left");
  });

  it("reorderWithinSide reorders and persists without changing the active panel", () => {
    useUiStore.getState().reorderWithinSide("right", 3, 0); // ports (last) → front
    expect(useUiStore.getState().panelOrder.right[0]).toBe("ports");
    expect(useUiStore.getState().activePanel.right).toBe("explorer");
    expect(loadDockLayout().panelOrder.right[0]).toBe("ports");
  });

  it("keeps every panel exactly once after a move and round-trips through storage", () => {
    useUiStore.getState().movePanel("workspaces", "right", 1);
    const s = useUiStore.getState();
    const all = [...s.panelOrder.left, ...s.panelOrder.right];
    expect([...all].sort()).toEqual([...PANEL_IDS].sort());
    expect(loadDockLayout()).toEqual({
      panelDock: s.panelDock,
      panelOrder: s.panelOrder,
      activePanel: s.activePanel,
      width: s.width,
      visible: s.visible,
    });
  });
});

describe("uiStore reorderSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ sidebarOrder: [...DEFAULT_SIDEBAR_ORDER] });
  });

  it("moves an icon from one position to another and persists it", () => {
    // Move "sessions" (last) to the front.
    useUiStore.getState().reorderSidebar(6, 0);
    const order = useUiStore.getState().sidebarOrder;
    expect(order[0]).toBe("sessions");
    expect(order).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
    // Persisted, so the next load reflects it.
    expect(loadSidebarOrder()).toEqual(order);
  });

  it("ignores out-of-bounds and no-op moves", () => {
    const before = [...useUiStore.getState().sidebarOrder];
    useUiStore.getState().reorderSidebar(-1, 2);
    useUiStore.getState().reorderSidebar(0, 99);
    useUiStore.getState().reorderSidebar(3, 3);
    expect(useUiStore.getState().sidebarOrder).toEqual(before);
  });
});
