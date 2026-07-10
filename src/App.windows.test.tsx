import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// On Windows the native menu bar is hidden (the window runs with decorations
// off and a custom title bar), so the menu accelerators that drive Close Tab /
// Cycle Pane / New Window on macOS never fire. App.tsx handles those in its
// webview keydown handler instead, gated on IS_WINDOWS. Force that gate on here
// while preserving the module's other exports (IS_MAC etc.).
vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return { ...actual, IS_WINDOWS: true };
});

// The Windows title bar calls Tauri window APIs on mount, which jsdom has no
// backend for; the shortcut handler under test does not need it, so stub it out.
vi.mock("@/components/TitleBar", () => ({ TitleBar: () => null }));

// ⌘/Ctrl+W is delivered as a `menu:close-tab` event on macOS; on Windows the
// keydown handler drives it directly. The webview still needs a listen/setZoom
// stub for App to mount.
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    setZoom: () => Promise.resolve(),
    listen: () => Promise.resolve(() => {}),
  }),
}));

import App from "./App";
import "./i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf, splitLeaf } from "@/modules/terminal/lib/terminalLayout";

describe("App shell — Windows keyboard shortcuts", () => {
  beforeEach(() => {
    useSettingsStore.setState({ language: "en", themeId: "vitesse-dark" });
    useUiStore.setState({
      sidebarVisible: true,
      settingsOpen: false,
      sidebarView: "explorer",
      fileFinderOpen: false,
    });
    useWorkspaceStore.setState({ rootPath: null });
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("closes the focused pane with Ctrl+W (menu accelerator is unavailable)", () => {
    const paneTree = splitLeaf(
      leaf("left-leaf", { kind: "launcher" }),
      "left-leaf",
      "row",
      "right-leaf",
      { kind: "launcher" },
    );
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
          paneOrder: ["left-leaf", "right-leaf"],
        },
      ],
      activeId: "a",
    });
    render(<App />);

    // One Ctrl+W peels exactly the focused (left) pane, leaving the right one.
    fireEvent.keyDown(window, { code: "KeyW", key: "w", ctrlKey: true });

    const tab = useTabsStore.getState().tabs.find((t) => t.id === "a");
    expect(tab?.paneTree).toEqual(leaf("right-leaf", { kind: "launcher" }));
  });

  it("ignores Windows-key combos (Win+W must not close a tab)", () => {
    const paneTree = splitLeaf(
      leaf("left-leaf", { kind: "launcher" }),
      "left-leaf",
      "row",
      "right-leaf",
      { kind: "launcher" },
    );
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
          paneOrder: ["left-leaf", "right-leaf"],
        },
      ],
      activeId: "a",
    });
    render(<App />);

    // metaKey is the Windows key here — Win+W must be left to the OS, not close a pane.
    fireEvent.keyDown(window, { code: "KeyW", key: "w", metaKey: true });

    const tab = useTabsStore.getState().tabs.find((t) => t.id === "a");
    expect(tab?.paneTree).toEqual(paneTree);
  });

  it("cycles panes with Ctrl+` and switches tabs with Ctrl+digit", () => {
    const tabs = ["a", "b"].map((id) => ({
      id,
      spaceId: "s1",
      title: id,
      kind: "launcher" as const,
      paneTree: leaf(`${id}-leaf`, { kind: "launcher" }),
      activeLeafId: `${id}-leaf`,
      paneOrder: [`${id}-leaf`],
    }));
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space 1" }],
      activeSpaceId: "s1",
      tabs,
      activeId: "a",
    });
    render(<App />);

    // Ctrl+2 switches to the second tab (works on every platform).
    fireEvent.keyDown(window, { code: "Digit2", key: "2", ctrlKey: true });
    expect(useTabsStore.getState().activeId).toBe("b");

    // Ctrl+` is a no-op with a single pane but must not throw or switch tabs.
    fireEvent.keyDown(window, { code: "Backquote", key: "`", ctrlKey: true });
    expect(useTabsStore.getState().activeId).toBe("b");
  });

  it("cycles focus between panes in a two-pane tab with Ctrl+`", () => {
    const paneTree = splitLeaf(
      leaf("left-leaf", { kind: "launcher" }),
      "left-leaf",
      "row",
      "right-leaf",
      { kind: "launcher" },
    );
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
          paneOrder: ["left-leaf", "right-leaf"],
        },
      ],
      activeId: "a",
    });
    render(<App />);

    fireEvent.keyDown(window, { code: "Backquote", key: "`", ctrlKey: true });

    const tab = useTabsStore.getState().tabs.find((t) => t.id === "a");
    expect(tab?.activeLeafId).toBe("right-leaf");
  });
});
