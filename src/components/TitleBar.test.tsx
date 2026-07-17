import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { useTabsStore, type Tab } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";

// IS_WINDOWS is a module-load const; expose it through a getter so each test can
// flip the platform without re-importing the module.
const platformMock = vi.hoisted(() => ({ isWindows: true }));
vi.mock("@/lib/platform", () => ({
  get IS_WINDOWS() {
    return platformMock.isWindows;
  },
}));

const {
  minimizeWindow,
  toggleMaximizeWindow,
  toggleFullscreenWindow,
  closeWindow,
  isWindowMaximized,
  onWindowResized,
  emitWindowMenuEvent,
} = vi.hoisted(() => ({
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  toggleFullscreenWindow: vi.fn(),
  closeWindow: vi.fn(),
  isWindowMaximized: vi.fn(),
  onWindowResized: vi.fn(),
  emitWindowMenuEvent: vi.fn(),
}));
vi.mock("@/lib/window", () => ({
  minimizeWindow,
  toggleMaximizeWindow,
  toggleFullscreenWindow,
  closeWindow,
  isWindowMaximized,
  onWindowResized,
  emitWindowMenuEvent,
}));

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { TitleBar } from "./TitleBar";

/** A single-pane tab: a lone terminal leaf, so leaf-count-dependent items
 * (Cycle Pane) are disabled. */
function makeSingleTerminalTabState() {
  const paneId = "pane-solo";
  const tab: Tab = {
    id: "tab-solo",
    spaceId: "space-1",
    title: "Terminal",
    kind: "terminal",
    paneTree: leaf(paneId, { kind: "terminal" }),
    activeLeafId: paneId,
    paneOrder: [paneId],
  };
  return {
    tabs: [tab],
    activeId: tab.id,
    spaces: [{ id: "space-1", name: "Workspace 1" }],
    activeSpaceId: "space-1",
  };
}

/** A two-pane terminal tab, so pane-count and pane-kind disabled predicates
 * default to enabled for the tests that don't care about disabled state. */
function makeTwoPaneTerminalTabState() {
  const paneA = "pane-a";
  const paneB = "pane-b";
  const tab: Tab = {
    id: "tab-two",
    spaceId: "space-1",
    title: "Terminal",
    kind: "terminal",
    paneTree: {
      kind: "split",
      direction: "row",
      children: [leaf(paneA, { kind: "terminal" }), leaf(paneB, { kind: "terminal" })],
      sizes: [0.5, 0.5],
    },
    activeLeafId: paneA,
    paneOrder: [paneA, paneB],
  };
  return {
    tabs: [tab],
    activeId: tab.id,
    spaces: [{ id: "space-1", name: "Workspace 1" }],
    activeSpaceId: "space-1",
  };
}

beforeEach(() => {
  platformMock.isWindows = true;
  minimizeWindow.mockReset();
  toggleMaximizeWindow.mockReset();
  toggleFullscreenWindow.mockReset();
  closeWindow.mockReset();
  isWindowMaximized.mockReset().mockResolvedValue(false);
  onWindowResized.mockReset().mockResolvedValue(() => {});
  emitWindowMenuEvent.mockReset().mockResolvedValue(undefined);
  invoke.mockReset().mockResolvedValue(undefined);
  useTabsStore.setState(makeTwoPaneTerminalTabState());
});

describe("TitleBar", () => {
  it("renders minimize, maximize and close controls on Windows", () => {
    render(<TitleBar />);
    expect(screen.getByLabelText("Minimize")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximize")).toBeInTheDocument();
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("drives the window controls when the buttons are clicked", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByLabelText("Minimize"));
    fireEvent.click(screen.getByLabelText("Maximize"));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(minimizeWindow).toHaveBeenCalledOnce();
    expect(toggleMaximizeWindow).toHaveBeenCalledOnce();
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it("marks the brand mark as a deep drag region so the icon and title drag the window", () => {
    render(<TitleBar />);
    const brand = screen.getByText("TempoTerm").closest("[data-tauri-drag-region]");
    // "deep" (not a bare attribute): a bare data-tauri-drag-region is "self
    // mode" and only drags on direct hits of the div, so grabbing the child
    // icon or title text would do nothing. See Tauri's drag.js.
    expect(brand).toHaveAttribute("data-tauri-drag-region", "deep");
  });

  it("shows the restore control once the window reports it is maximized", async () => {
    isWindowMaximized.mockResolvedValue(true);
    render(<TitleBar />);
    expect(await screen.findByLabelText("Restore")).toBeInTheDocument();
    expect(screen.queryByLabelText("Maximize")).toBeNull();
  });

  it("opens the File menu and runs each action through the shared handlers", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "File" }));

    fireEvent.click(screen.getByRole("menuitem", { name: /New Window/ }));
    expect(invoke).toHaveBeenCalledWith("open_new_window");

    fireEvent.click(screen.getByRole("button", { name: "File" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Close Tab/ }));
    expect(emitWindowMenuEvent).toHaveBeenCalledWith("menu:close-tab", undefined);
  });

  it("selecting an item closes the menu", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "Window" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Minimize/ }));
    expect(minimizeWindow).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the Window menu and toggles fullscreen", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "Window" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Toggle Full Screen/ }));
    expect(toggleFullscreenWindow).toHaveBeenCalledOnce();
  });

  it("clicking the open menu button toggles it shut", () => {
    render(<TitleBar />);
    const fileButton = screen.getByRole("button", { name: "File" });
    fireEvent.click(fileButton);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(fileButton);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders all 6 top-level menus", () => {
    render(<TitleBar />);
    for (const label of ["File", "Edit", "View", "Terminal", "Window", "Help"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("collapses menus that don't fit into a […] button and reveals them on demand", () => {
    // jsdom does no layout, so force the measurements the fit math reads: every
    // button/label measures 100px wide and the bar is only 250px — so just the
    // first menu fits beside the 100px […] button; the rest collapse.
    const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 32,
      top: 0,
      left: 0,
      right: 100,
      bottom: 32,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const cwDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
    Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => 250 });
    try {
      render(<TitleBar />);
      // File fits; Window has collapsed out of the bar into the overflow button.
      expect(screen.getByRole("button", { name: "File" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Window" })).toBeNull();
      const more = screen.getByLabelText("More menus");

      // Opening […] lists the collapsed menus; hovering one cascades its items
      // out to the side (rather than stacking a dropdown over the list)…
      fireEvent.click(more);
      fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Window" }));
      // …and choosing an item from that cascade still runs its action.
      fireEvent.click(screen.getByRole("menuitem", { name: /Toggle Full Screen/ }));
      expect(toggleFullscreenWindow).toHaveBeenCalledOnce();
    } finally {
      rectSpy.mockRestore();
      if (cwDescriptor) {
        Object.defineProperty(Element.prototype, "clientWidth", cwDescriptor);
      }
    }
  });

  it("prevents default on mousedown for menu-bar buttons and dropdown items, so the underlying editable keeps its selection", () => {
    render(<TitleBar />);
    const fileButton = screen.getByRole("button", { name: "File" });
    // fireEvent's dispatchEvent returns false when the event was canceled
    // (preventDefault called) — the standard DOM signal, not a custom one.
    expect(fireEvent.mouseDown(fileButton)).toBe(false);

    fireEvent.click(fileButton);
    const item = screen.getByRole("menuitem", { name: /New Window/ });
    expect(fireEvent.mouseDown(item)).toBe(false);
  });

  it("greys out disabled items and does not emit on click", () => {
    // Single pane, terminal focused: Cycle Pane must be disabled
    useTabsStore.setState(makeSingleTerminalTabState());
    render(<TitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    const item = screen.getByRole("menuitem", { name: /Cycle Pane/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);
    expect(emitWindowMenuEvent).not.toHaveBeenCalled();
  });

  it("opens the sidebar submenu on hover and emits with the panel payload", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /Sidebar Panel/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Explorer/ }));
    expect(emitWindowMenuEvent).toHaveBeenCalledWith("menu:sidebar-panel", "explorer");
  });

  describe("submenu hover-close delay", () => {
    // Diagonal mouse travel from the "Sidebar Panel" row toward its flyout
    // crosses a sibling row first ("Toggle Left Sidebar" or "Preview Back"). An
    // instant close on that sibling-enter kills the flyout before the
    // cursor arrives — this delay is what lets diagonal travel succeed.
    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps the submenu open when the cursor reaches the flyout before the close delay elapses", () => {
      vi.useFakeTimers();
      render(<TitleBar />);
      fireEvent.click(screen.getByRole("button", { name: "View" }));
      fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /Sidebar Panel/ }));
      const flyout = screen.getByRole("menuitem", { name: /Explorer/ }).closest('[role="menu"]');
      expect(flyout).not.toBeNull();

      fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /Toggle Left Sidebar/ }));
      act(() => {
        vi.advanceTimersByTime(100);
      });
      // The cursor reaches the flyout inside the close window — cancels it.
      fireEvent.mouseEnter(flyout as Element);
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByRole("menuitem", { name: /Explorer/ })).toBeInTheDocument();
    });

    it("closes the submenu once the close delay elapses without the cursor reaching the flyout", () => {
      vi.useFakeTimers();
      render(<TitleBar />);
      fireEvent.click(screen.getByRole("button", { name: "View" }));
      fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /Sidebar Panel/ }));
      expect(screen.getByRole("menuitem", { name: /Explorer/ })).toBeInTheDocument();

      fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /Toggle Left Sidebar/ }));
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.queryByRole("menuitem", { name: /Explorer/ })).toBeNull();
    });
  });
});

describe("on macOS", () => {
  beforeEach(() => {
    platformMock.isWindows = false;
  });

  it("renders nothing (native menu owns the menus, TabBar is the first row)", () => {
    const { container } = render(<TitleBar />);
    expect(container.firstChild).toBeNull();
  });
});
