import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { TabBar } from "./TabBar";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";
import { useEntryDragStore } from "@/modules/explorer/lib/dragEntry";
import { useNoteDragStore } from "@/modules/notes/lib/noteDrag";
import { useSshDragStore } from "@/modules/ssh/lib/sshDrag";
import { useUiStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

// IS_MAC is a module-load const; expose it through a getter so a test can flip
// the platform without re-importing the module.
const platformMock = vi.hoisted(() => ({ isMac: false }));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  get IS_MAC() {
    return platformMock.isMac;
  },
}));

beforeEach(() => {
  useTabsStore.setState({
    spaces: [{ id: "s1", name: "One" }],
    activeSpaceId: "s1",
    tabs: [
      {
        id: "t1",
        spaceId: "s1",
        title: "Terminal 1",
        kind: "terminal",
        paneTree: leaf("p1", { kind: "terminal" }),
        activeLeafId: "p1",
        paneOrder: ["p1"],
      },
    ],
    activeId: "t1",
  });
});

afterEach(() => {
  useEntryDragStore.setState({ tabBarHover: null });
  useNoteDragStore.setState({ tabBarHover: null });
  useSshDragStore.setState({ tabBarHover: null });
  useWorkspaceStore.setState({ rootPath: null });
});

describe("TabBar global file search trigger", () => {
  it("opens the global file search when a local folder is open", () => {
    useWorkspaceStore.setState({ rootPath: "/home/me/project" });
    useUiStore.setState({ fileFinderOpen: false });
    render(<TabBar />);

    fireEvent.click(screen.getByLabelText("Find files"));

    expect(useUiStore.getState().fileFinderOpen).toBe(true);
  });

  it("disables the trigger when no folder is open", () => {
    useWorkspaceStore.setState({ rootPath: null });
    render(<TabBar />);

    expect(screen.getByLabelText("Find files")).toBeDisabled();
  });

  it("disables the trigger for a remote (SSH) root", () => {
    useWorkspaceStore.setState({ rootPath: "ssh://c1/home/me" });
    render(<TabBar />);

    expect(screen.getByLabelText("Find files")).toBeDisabled();
  });
});

describe("TabBar close button tooltip", () => {
  // A split tab shows a second close button in each pane header one row below,
  // so the ✕ cannot stand on its own — it has to name the level it acts on.
  it("names the tab on a clean tab's close button", () => {
    vi.useFakeTimers();
    try {
      render(<TabBar />);
      const close = screen.getByLabelText("Close Tab");
      fireEvent.mouseEnter(close.parentElement!);
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByRole("tooltip")).toHaveTextContent("Close Tab");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TabBar middle-click close", () => {
  const auxClick = (el: Element, button: number) =>
    fireEvent(el, new MouseEvent("auxclick", { bubbles: true, button }));

  it("closes the tab on middle-click (no unsaved changes)", () => {
    render(<TabBar />);
    auxClick(screen.getByRole("tab"), 1);
    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it("leaves the tab alone on other aux buttons", () => {
    render(<TabBar />);
    auxClick(screen.getByRole("tab"), 2);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });
});

describe("TabBar tab context menu", () => {
  it("opens a context menu with a rename item on right-click", () => {
    render(<TabBar />);
    const tab = screen.getByRole("tab");
    fireEvent.contextMenu(tab);
    expect(
      screen.getByRole("menuitem", { name: "Rename Tab" }),
    ).toBeInTheDocument();
  });

  it("starts inline editing with the current title when rename is clicked", () => {
    render(<TabBar />);
    fireEvent.contextMenu(screen.getByRole("tab"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename Tab" }));
    expect(screen.getByRole("textbox")).toHaveValue("Terminal 1");
  });

  it("closes the tab when the close item is clicked (no unsaved changes)", () => {
    render(<TabBar />);
    fireEvent.contextMenu(screen.getByRole("tab"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Close Tab" }));
    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it("does not open a context menu when right-clicking the rename input", () => {
    render(<TabBar />);
    fireEvent.contextMenu(screen.getByRole("tab"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename Tab" }));
    // Right-clicking the rename field must not open a fresh tab menu, but the
    // event must still bubble to the window so the app-wide text-field menu
    // (InputContextMenu) can handle it.
    const onWindowContextMenu = vi.fn();
    window.addEventListener("contextmenu", onWindowContextMenu);
    try {
      fireEvent.contextMenu(screen.getByRole("textbox"));
      expect(screen.queryByRole("menuitem")).toBeNull();
      expect(onWindowContextMenu).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("contextmenu", onWindowContextMenu);
    }
  });

  it("marks the tab strip as a drop target for open-in-new-tab", () => {
    render(<TabBar />);
    expect(document.querySelector("[data-tab-bar]")).not.toBeNull();
  });
});

describe("TabBar insertion line", () => {
  beforeEach(() => {
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "One" }],
      activeSpaceId: "s1",
      tabs: [
        {
          id: "t1",
          spaceId: "s1",
          title: "Terminal 1",
          kind: "terminal",
          paneTree: leaf("p1", { kind: "terminal" }),
          activeLeafId: "p1",
          paneOrder: ["p1"],
        },
        {
          id: "t2",
          spaceId: "s1",
          title: "Terminal 2",
          kind: "terminal",
          paneTree: leaf("p2", { kind: "terminal" }),
          activeLeafId: "p2",
          paneOrder: ["p2"],
        },
      ],
      activeId: "t1",
    });
  });

  it("renders no insertion line when no drag store reports a tab-bar hover", () => {
    render(<TabBar />);
    expect(screen.queryByTestId("tab-insertion-line")).toBeNull();
  });

  it("renders the insertion line immediately before the tab named by insertBeforeId", () => {
    useEntryDragStore.setState({ tabBarHover: { insertBeforeId: "t2" } });
    render(<TabBar />);
    const strip = document.querySelector("[data-tab-strip]");
    expect(strip).not.toBeNull();
    const children = Array.from(strip!.children);
    const lineIndex = children.findIndex((el) => el.getAttribute("data-testid") === "tab-insertion-line");
    const t2Index = children.findIndex((el) => el.getAttribute("data-tab-id") === "t2");
    expect(lineIndex).toBeGreaterThanOrEqual(0);
    expect(lineIndex).toBe(t2Index - 1);
  });

  it("renders the insertion line after the last tab when insertBeforeId is null", () => {
    useNoteDragStore.setState({ tabBarHover: { insertBeforeId: null } });
    render(<TabBar />);
    const strip = document.querySelector("[data-tab-strip]");
    expect(strip).not.toBeNull();
    const children = Array.from(strip!.children);
    const lineIndex = children.findIndex((el) => el.getAttribute("data-testid") === "tab-insertion-line");
    // Last thing in the strip: the add-tab button lives outside it now, so
    // there is nothing left for the line to sit in front of.
    expect(lineIndex).toBeGreaterThanOrEqual(0);
    expect(lineIndex).toBe(children.length - 1);
    expect(children[lineIndex - 1].getAttribute("data-tab-id")).toBe("t2");
  });

  it("falls back through the entry, note, and ssh drag stores in that order", () => {
    useSshDragStore.setState({ tabBarHover: { insertBeforeId: "t1" } });
    render(<TabBar />);
    expect(screen.getByTestId("tab-insertion-line")).toBeInTheDocument();
  });
});

describe("TabBar overflow scrolling", () => {
  function addTab(id: string, title: string) {
    useTabsStore.setState((state) => ({
      tabs: [
        ...state.tabs,
        {
          id,
          spaceId: "s1",
          title,
          kind: "terminal" as const,
          paneTree: leaf(`p-${id}`, { kind: "terminal" as const }),
          activeLeafId: `p-${id}`,
          paneOrder: [`p-${id}`],
        },
      ],
    }));
  }

  it("asks for the hairline scrollbar off macOS", () => {
    render(<TabBar />);
    const strip = document.querySelector("[data-tab-strip]");
    expect(strip?.className).toContain("overflow-x-auto");
    // index.css keys its ::-webkit-scrollbar rule off this value.
    expect(strip?.getAttribute("data-tab-strip")).toBe("hairline");
  });

  it("keeps the window drag region off the scrolling strip", () => {
    render(<TabBar />);
    const strip = document.querySelector<HTMLElement>("[data-tab-strip]")!;

    // Tauri swallows mousedown on a drag region to move the window, and the
    // scrollbar belongs to this element, so a drag region here means the thumb
    // can never be dragged. The slack beside the strip carries it instead.
    expect(strip.hasAttribute("data-tauri-drag-region")).toBe(false);
    const slack = strip.parentElement?.querySelector("[data-tauri-drag-region]");
    expect(slack).not.toBeNull();
  });

  it("asks for the hairline on macOS too", () => {
    platformMock.isMac = true;
    try {
      render(<TabBar />);
      // WKWebView's overlay bar is thin and transient only while "Show scroll
      // bars" is on its default; set to "Always" it draws a classic bar under
      // the tab labels. The hairline is thinner in that mode and still fades
      // with the overlay behaviour in the other.
      expect(document.querySelector("[data-tab-strip]")?.getAttribute("data-tab-strip")).toBe(
        "hairline",
      );
    } finally {
      platformMock.isMac = false;
    }
  });

  it("blocks the autoscroll that would eat middle-click-to-close", () => {
    render(<TabBar />);
    const strip = document.querySelector<HTMLElement>("[data-tab-strip]")!;
    const tab = document.querySelector<HTMLElement>('[data-tab-id="t1"]')!;

    // A scrolling strip is a scroll container, and Chromium opens autoscroll on
    // a middle-click there instead of delivering the auxclick the close gesture
    // listens for. Cancelled on the strip, so tabs and empty space both count.
    for (const target of [strip, tab]) {
      const middle = fireEvent.mouseDown(target, { button: 1, bubbles: true, cancelable: true });
      expect(middle).toBe(false);
    }
    // Left-clicks are untouched — dragging a tab still has to work.
    expect(fireEvent.mouseDown(tab, { button: 0, bubbles: true, cancelable: true })).toBe(true);
  });

  it("scrolls the strip sideways on a plain wheel", () => {
    render(<TabBar />);
    const strip = document.querySelector<HTMLElement>("[data-tab-strip]")!;

    fireEvent.wheel(strip, { deltaY: 120 });

    expect(strip.scrollLeft).toBe(120);
  });

  it("steps through the tabs on shift+wheel, stopping at the ends", () => {
    addTab("t2", "Terminal 2");
    render(<TabBar />);
    const strip = document.querySelector<HTMLElement>("[data-tab-strip]")!;

    fireEvent.wheel(strip, { deltaY: 100, shiftKey: true });
    expect(useTabsStore.getState().activeId).toBe("t2");
    // Last tab: nothing to step onto, and the strip must not scroll instead.
    fireEvent.wheel(strip, { deltaY: 100, shiftKey: true });
    expect(useTabsStore.getState().activeId).toBe("t2");
    expect(strip.scrollLeft).toBe(0);

    fireEvent.wheel(strip, { deltaY: -100, shiftKey: true });
    expect(useTabsStore.getState().activeId).toBe("t1");
  });

  it("ignores a shift+wheel too small to count as a step", () => {
    addTab("t2", "Terminal 2");
    render(<TabBar />);
    const strip = document.querySelector<HTMLElement>("[data-tab-strip]")!;

    // A trackpad's fine deltas accumulate rather than stepping on every event.
    for (let i = 0; i < 4; i++) {
      fireEvent.wheel(strip, { deltaY: 20, shiftKey: true });
    }
    expect(useTabsStore.getState().activeId).toBe("t1");
    fireEvent.wheel(strip, { deltaY: 20, shiftKey: true });
    expect(useTabsStore.getState().activeId).toBe("t2");
  });

  it("keeps the add-tab button out of the scrolling strip", () => {
    render(<TabBar />);
    const add = screen.getByLabelText("Add tab");

    // Outside the strip, so overflowing tabs scroll past it rather than over
    // it — and it needs no backdrop of its own, which over a background image
    // would only compound the row's tint into a visible patch.
    expect(add.closest("[data-tab-strip]")).toBeNull();
    // Still inside the drop target the drag stores resolve against.
    expect(add.closest("[data-tab-bar]")).not.toBeNull();
  });

  it("brings a newly activated tab into view", () => {
    addTab("t2", "Terminal 2");
    render(<TabBar />);
    const strip = document.querySelector<HTMLElement>("[data-tab-strip]")!;
    const tab = document.querySelector<HTMLElement>('[data-tab-id="t2"]')!;
    // jsdom does no layout: the strip shows 0-200 and t2 sits at 260-360.
    strip.getBoundingClientRect = () => ({ left: 0, right: 200 }) as DOMRect;
    tab.getBoundingClientRect = () => ({ left: 260, right: 360 }) as DOMRect;

    act(() => {
      useTabsStore.setState({ activeId: "t2" });
    });

    // Scrolled by exactly what it took to make t2's right edge flush, no more.
    expect(strip.scrollLeft).toBe(160);
  });

  it("leaves the strip alone when the activated tab is already visible", () => {
    addTab("t2", "Terminal 2");
    render(<TabBar />);
    const strip = document.querySelector<HTMLElement>("[data-tab-strip]")!;
    const tab = document.querySelector<HTMLElement>('[data-tab-id="t2"]')!;
    strip.scrollLeft = 40;
    strip.getBoundingClientRect = () => ({ left: 0, right: 200 }) as DOMRect;
    tab.getBoundingClientRect = () => ({ left: 90, right: 190 }) as DOMRect;

    act(() => {
      useTabsStore.setState({ activeId: "t2" });
    });

    expect(strip.scrollLeft).toBe(40);
  });
});
