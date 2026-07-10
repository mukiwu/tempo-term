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
  it("shows no tooltip on a clean tab's close button (the ✕ is self-explanatory)", () => {
    vi.useFakeTimers();
    try {
      render(<TabBar />);
      const close = screen.getByLabelText("Close Tab");
      fireEvent.mouseEnter(close.parentElement!);
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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
    const tabBar = document.querySelector("[data-tab-bar]");
    expect(tabBar).not.toBeNull();
    const children = Array.from(tabBar!.children);
    const lineIndex = children.findIndex((el) => el.getAttribute("data-testid") === "tab-insertion-line");
    const t2Index = children.findIndex((el) => el.getAttribute("data-tab-id") === "t2");
    expect(lineIndex).toBeGreaterThanOrEqual(0);
    expect(lineIndex).toBe(t2Index - 1);
  });

  it("renders the insertion line after the last tab and before the add-tab button when insertBeforeId is null", () => {
    useNoteDragStore.setState({ tabBarHover: { insertBeforeId: null } });
    render(<TabBar />);
    const tabBar = document.querySelector("[data-tab-bar]");
    expect(tabBar).not.toBeNull();
    const children = Array.from(tabBar!.children);
    const lineIndex = children.findIndex((el) => el.getAttribute("data-testid") === "tab-insertion-line");
    // The add-tab button sits inside its Tooltip wrapper, so match the child
    // that contains it rather than the button element itself.
    const addButtonIndex = children.findIndex(
      (el) => el.querySelector('[aria-label="Add tab"]') !== null,
    );
    expect(lineIndex).toBeGreaterThanOrEqual(0);
    expect(lineIndex).toBe(addButtonIndex - 1);
  });

  it("falls back through the entry, note, and ssh drag stores in that order", () => {
    useSshDragStore.setState({ tabBarHover: { insertBeforeId: "t1" } });
    render(<TabBar />);
    expect(screen.getByTestId("tab-insertion-line")).toBeInTheDocument();
  });
});
