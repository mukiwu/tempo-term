import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "@/i18n";
import { TabBar } from "./TabBar";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";

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
      },
    ],
    activeId: "t1",
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
    // Right-clicking the rename field must not bubble up and open a fresh tab
    // menu over the input being edited.
    fireEvent.contextMenu(screen.getByRole("textbox"));
    expect(screen.queryByRole("menuitem")).toBeNull();
  });
});
