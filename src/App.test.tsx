import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import "./i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";

describe("App shell", () => {
  beforeEach(() => {
    useSettingsStore.setState({ language: "en", themeId: "vitesse-dark" });
    // Show the sidebar (with its Explorer/Git/Notes tabs) and the settings
    // modal (with the language picker); keep it light for jsdom.
    useUiStore.setState({
      sidebarVisible: true,
      settingsOpen: true,
      sidebarView: "explorer",
      fileFinderOpen: false,
    });
    // Start every test with no tabs so the default render mounts no terminal
    // panes (which need a Tauri runtime jsdom doesn't provide).
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("renders the sidebar tabs and settings labels in English by default", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Explorer" })).toBeInTheDocument();
    expect(screen.getByText("Display language")).toBeInTheDocument();
  });

  it("switches the whole UI to Traditional Chinese when the language changes", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "正體中文" }));
    expect(await screen.findByRole("button", { name: "檔案總管" })).toBeInTheDocument();
    expect(screen.getByText("顯示語言")).toBeInTheDocument();
  });

  it("switches to the Nth tab of the active space with Cmd+digit", () => {
    const tabs = ["a", "b", "c"].map((id) => ({
      id,
      spaceId: "s1",
      title: id,
      kind: "launcher" as const,
      // Launcher panes render a lightweight panel — no terminal, so no Tauri.
      paneTree: leaf(`${id}-leaf`, { kind: "launcher" }),
      activeLeafId: `${id}-leaf`,
    }));
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space 1" }],
      activeSpaceId: "s1",
      tabs,
      activeId: "a",
    });
    render(<App />);

    fireEvent.keyDown(window, { code: "Digit2", key: "2", metaKey: true });
    expect(useTabsStore.getState().activeId).toBe("b");

    // A digit past the last tab is a no-op rather than clearing the selection.
    fireEvent.keyDown(window, { code: "Digit9", key: "9", metaKey: true });
    expect(useTabsStore.getState().activeId).toBe("b");
  });

  it("selects the Nth sidebar panel with Option+digit", () => {
    render(<App />);
    // Order is workspaces, explorer, sourceControl, notes, ai, connections.
    fireEvent.keyDown(window, { code: "Digit3", key: "£", altKey: true });
    expect(useUiStore.getState().sidebarView).toBe("sourceControl");

    fireEvent.keyDown(window, { code: "Digit1", key: "¡", altKey: true });
    expect(useUiStore.getState().sidebarView).toBe("workspaces");
  });
});
