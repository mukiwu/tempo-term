import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import "./i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf, splitLeaf } from "@/modules/terminal/lib/terminalLayout";

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

  it("closes the focused pane with Cmd+W, not the bottom-right one", () => {
    // Two launcher panes (left + right); focus the left one. Cmd+W must peel
    // away the focused pane, leaving the right pane behind.
    const paneTree = splitLeaf(leaf("left-leaf", { kind: "launcher" }), "left-leaf", "row", "right-leaf", {
      kind: "launcher",
    });
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space 1" }],
      activeSpaceId: "s1",
      tabs: [
        {
          id: "a",
          spaceId: "s1",
          title: "a",
          kind: "launcher" as const,
          paneTree,
          activeLeafId: "left-leaf",
        },
      ],
      activeId: "a",
    });
    render(<App />);

    fireEvent.keyDown(window, { code: "KeyW", key: "w", metaKey: true });

    const tab = useTabsStore.getState().tabs.find((t) => t.id === "a");
    expect(tab?.paneTree).toEqual(leaf("right-leaf", { kind: "launcher" }));
  });

  it("selects the Nth sidebar panel with Option+digit", () => {
    render(<App />);
    // Order is workspaces, explorer, sourceControl, notes, ai, connections.
    fireEvent.keyDown(window, { code: "Digit3", key: "£", altKey: true });
    expect(useUiStore.getState().sidebarView).toBe("sourceControl");

    fireEvent.keyDown(window, { code: "Digit1", key: "¡", altKey: true });
    expect(useUiStore.getState().sidebarView).toBe("workspaces");
  });

  it("ignores navigation shortcuts while typing in a non-terminal text field", () => {
    const tabs = ["a", "b", "c"].map((id) => ({
      id,
      spaceId: "s1",
      title: id,
      kind: "launcher" as const,
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

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    // ⌘2 typed in a text field must not switch tabs.
    fireEvent.keyDown(input, { code: "Digit2", key: "2", metaKey: true });
    expect(useTabsStore.getState().activeId).toBe("a");

    // ⌥1 must not hijack the sidebar either — ⌥+number is normal text entry on
    // macOS (it types ¡), so the keystroke belongs to the input.
    fireEvent.keyDown(input, { code: "Digit1", key: "¡", altKey: true });
    expect(useUiStore.getState().sidebarView).toBe("explorer");

    input.remove();
  });
});
