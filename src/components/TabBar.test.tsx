import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/i18n";
import { TabBar } from "./TabBar";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";
import { useEntryDragStore } from "@/modules/explorer/lib/dragEntry";
import { useNoteDragStore } from "@/modules/notes/lib/noteDrag";
import { useSshDragStore } from "@/modules/ssh/lib/sshDrag";

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
    // Right-clicking the rename field must not bubble up and open a fresh tab
    // menu over the input being edited.
    fireEvent.contextMenu(screen.getByRole("textbox"));
    expect(screen.queryByRole("menuitem")).toBeNull();
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
    const addButtonIndex = children.findIndex((el) => el.getAttribute("aria-label") === "Add tab");
    expect(lineIndex).toBeGreaterThanOrEqual(0);
    expect(lineIndex).toBe(addButtonIndex - 1);
  });

  it("falls back through the entry, note, and ssh drag stores in that order", () => {
    useSshDragStore.setState({ tabBarHover: { insertBeforeId: "t1" } });
    render(<TabBar />);
    expect(screen.getByTestId("tab-insertion-line")).toBeInTheDocument();
  });
});
