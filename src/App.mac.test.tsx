import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The native macOS menu is reduced to App + Edit (see menu.rs): it carries no
// custom items or accelerators anymore, so every shortcut that used to fire via
// a menu accelerator on macOS (Close Tab, New Window, Cycle Pane, Open
// Location) is now driven directly by App.tsx's webview keydown handler, same
// as Windows. Force IS_WINDOWS off so the primary modifier resolves to Cmd.
vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return { ...actual, IS_WINDOWS: false };
});

// The title bar calls Tauri window APIs on mount, which jsdom has no backend
// for; the shortcut handler under test does not need it, so stub it out.
vi.mock("@/components/TitleBar", () => ({ TitleBar: () => null }));

// The webview still needs a listen/setZoom stub for App to mount.
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    setZoom: () => Promise.resolve(),
    listen: () => Promise.resolve(() => {}),
  }),
}));

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import App from "./App";
import "./i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf, splitLeaf } from "@/modules/terminal/lib/terminalLayout";

describe("App shell — macOS keyboard shortcuts", () => {
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
    invokeMock.mockReset().mockResolvedValue(undefined);
  });

  it("Cmd+W closes the active tab on macOS", () => {
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

    const before = useTabsStore.getState().tabs.length;
    fireEvent.keyDown(window, { code: "KeyW", key: "w", metaKey: true });

    // Two panes in one tab: Cmd+W peels the focused pane, not the whole tab —
    // assert on the pane tree, mirroring the equivalent Windows test.
    const tab = useTabsStore.getState().tabs.find((t) => t.id === "a");
    expect(tab?.paneTree).toEqual(leaf("right-leaf", { kind: "launcher" }));
    expect(useTabsStore.getState().tabs.length).toBe(before);
  });

  it("Cmd+N invokes open_new_window on macOS", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "KeyN", key: "n", metaKey: true });
    expect(invokeMock).toHaveBeenCalledWith("open_new_window");
  });

  it("does not intercept Cmd+C (owned by the native Edit menu)", () => {
    render(<App />);
    // App mounts several background invoke() calls unrelated to this shortcut
    // (detect_tools, system_stats, …); snapshot the count so the assertion is
    // about the keydown, not about the app's mount-time IPC traffic.
    const callsBefore = invokeMock.mock.calls.length;
    fireEvent.keyDown(window, { code: "KeyC", key: "c", metaKey: true });
    expect(invokeMock.mock.calls.length).toBe(callsBefore);
  });

  it("cycles panes with Cmd+` on macOS", () => {
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

    // A single pane in the active tab: Cmd+` is a no-op but must not throw.
    fireEvent.keyDown(window, { code: "Backquote", key: "`", metaKey: true });
    expect(useTabsStore.getState().activeId).toBe("a");
  });

  it("ignores Cmd combos when Alt is also held", () => {
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

    fireEvent.keyDown(window, { code: "KeyW", key: "w", metaKey: true, altKey: true });

    const tab = useTabsStore.getState().tabs.find((t) => t.id === "a");
    expect(tab?.paneTree).toEqual(paneTree);
  });
});
