import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "@/i18n";
import { Sidebar } from "./Sidebar";
import { useUiStore } from "@/stores/uiStore";
import { useTabsStore } from "@/stores/tabsStore";

beforeEach(() => {
  useUiStore.setState({ sidebarView: "workspaces", sidebarVisible: true });
  useTabsStore.setState({
    spaces: [{ id: "s1", name: "Salon" }],
    activeSpaceId: "s1",
    activeId: null,
    tabs: [],
  });
});

describe("Sidebar workspace entry", () => {
  it("shows a Workspaces entry as the leftmost sidebar tab", () => {
    const { container } = render(<Sidebar />);
    const navButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
    );
    expect(navButtons[0]?.getAttribute("aria-label")).toBe("Workspaces");
  });

  it("renders the WorkspacePanel when the workspaces view is active", () => {
    render(<Sidebar />);
    // The panel footer button proves the workspaces branch rendered.
    expect(screen.getByRole("button", { name: "New space" })).toBeInTheDocument();
  });
});
