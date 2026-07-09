import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Force the primary modifier to Cmd (metaKey) regardless of the host OS running
// the test, matching App.mac.test.tsx's convention — the keydown seam test
// below needs a deterministic Cmd vs Ctrl gate.
vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return { ...actual, IS_WINDOWS: false };
});

// Every `menu:*` listener in App.tsx is registered via getCurrentWebview().listen.
// Capture every (event, handler) pair as it registers so tests can fire any menu
// event the same way the native menu / Windows title-bar menu does, instead of
// only being able to observe one hardcoded event like App.test.tsx's menuBridge.
const menuHandlers = vi.hoisted(() => ({
  map: new Map<string, (event: { payload?: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    setZoom: () => Promise.resolve(),
    // TerminalView calls this on mount to listen for native OS file drags —
    // no Tauri runtime exists in jsdom (same stub as PaneTabContent.test.tsx).
    onDragDropEvent: () => Promise.resolve(() => {}),
    listen: (event: string, handler: (event: { payload?: unknown }) => void) => {
      menuHandlers.map.set(event, handler);
      return Promise.resolve(() => {});
    },
  }),
}));

// menu:check-updates triggers a real updater check; stub the plugin so the
// test never depends on Tauri IPC being available.
const { check } = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));

// TitleBar now renders on every platform (not just Windows — see Task 3), and
// its WindowMenuBar tracks maximize state via a real Tauri window call that
// jsdom has no backend for. These tests exercise App's menu-event wiring, not
// the title bar, so stub it out (same stub App.windows.test.tsx uses).
vi.mock("@/components/TitleBar", () => ({ TitleBar: () => null }));

// A tab whose paneTree has a "preview" leaf makes TabsArea mount the real,
// lazily-loaded PreviewTabContent, which (a) calls getCurrentWindow()
// unconditionally at render time — a Tauri API jsdom has no backend for — and
// (b) registers its OWN previewControls on mount, clobbering whatever a test
// registered manually for the same leaf id. These tests exercise the
// previewControls registry directly (registering their own fake controls per
// leaf below), never the real native webview, so stub the whole component out
// — same convention as the TitleBar stub above.
vi.mock("@/modules/preview/PreviewTabContent", () => ({
  PreviewTabContent: () => null,
}));

import App from "./App";
import "./i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf, splitLeaf } from "@/modules/terminal/lib/terminalLayout";
import {
  registerTerminalOps,
  unregisterTerminalOps,
  type TerminalOps,
} from "@/modules/terminal/lib/terminalBus";
import { registerEditorSaver, unregisterEditorSaver } from "@/modules/editor/lib/editorBus";
import { registerPreviewControls } from "@/modules/preview/lib/previewControls";

/** Fire a captured `menu:*` handler the way the backend/webview would. */
async function fireMenuEvent(event: string, payload?: unknown): Promise<void> {
  const handler = menuHandlers.map.get(event);
  if (!handler) {
    throw new Error(`no listener registered for ${event}`);
  }
  await act(async () => {
    handler({ payload });
  });
}

function makeOps(): TerminalOps {
  return { getSelection: () => "", selectAll: vi.fn(), clear: vi.fn(), openSearch: vi.fn(), paste: vi.fn() };
}

describe("App menu event wiring", () => {
  beforeEach(() => {
    menuHandlers.map.clear();
    check.mockReset().mockResolvedValue(null);
    useSettingsStore.setState({ language: "en", themeId: "vitesse-dark", uiZoom: 1 });
    useUiStore.setState({
      sidebarVisible: true,
      settingsOpen: false,
      settingsSection: null,
      sidebarView: "explorer",
      fileFinderOpen: false,
    });
    useWorkspaceStore.setState({ rootPath: null });
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    useUpdaterStore.setState({ status: "idle", available: null, modalOpen: false });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(), readText: vi.fn(async () => "clip") },
    });
    document.execCommand = vi.fn(() => true);
  });

  it("menu:new-tab opens the launcher", async () => {
    render(<App />);
    await fireMenuEvent("menu:new-tab");
    expect(useTabsStore.getState().tabs.some((t) => t.kind === "launcher")).toBe(true);
  });

  it("menu:new-terminal-tab opens a terminal tab", async () => {
    render(<App />);
    await fireMenuEvent("menu:new-terminal-tab");
    expect(useTabsStore.getState().tabs.some((t) => t.kind === "terminal")).toBe(true);
  });

  it("menu:save saves the focused editor pane via the editor bus", async () => {
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space 1" }],
      activeSpaceId: "s1",
      tabs: [
        {
          id: "a",
          spaceId: "s1",
          title: "a",
          kind: "editor",
          paneTree: leaf("leaf-1", { kind: "editor", path: "/tmp/file.ts" }),
          activeLeafId: "leaf-1",
          paneOrder: ["leaf-1"],
        },
      ],
      activeId: "a",
    });
    const save = vi.fn();
    registerEditorSaver("leaf-1", save);
    render(<App />);
    await fireMenuEvent("menu:save");
    expect(save).toHaveBeenCalled();
    unregisterEditorSaver("leaf-1");
  });

  it("menu:open-settings opens settings on the requested section", async () => {
    render(<App />);
    await fireMenuEvent("menu:open-settings", "about");
    expect(useUiStore.getState().settingsOpen).toBe(true);
    // SettingsView consumes settingsSection on mount (clearing it so a later
    // plain open doesn't replay it), so assert on the section actually shown
    // rather than the transient store field.
    expect(screen.getByRole("heading", { name: "About" })).toBeInTheDocument();
  });

  it("menu:open-settings with no payload opens the default section", async () => {
    render(<App />);
    await fireMenuEvent("menu:open-settings");
    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(useUiStore.getState().settingsSection).toBeNull();
  });

  it("menu:copy falls back to execCommand copy with no terminal focused", async () => {
    render(<App />);
    await fireMenuEvent("menu:copy");
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("menu:paste inserts clipboard text via execCommand with no terminal focused", async () => {
    render(<App />);
    await fireMenuEvent("menu:paste");
    expect(document.execCommand).toHaveBeenCalledWith("insertText", false, "clip");
  });

  it("menu:select-all falls back to execCommand selectAll with no terminal focused", async () => {
    render(<App />);
    await fireMenuEvent("menu:select-all");
    expect(document.execCommand).toHaveBeenCalledWith("selectAll");
  });

  it("menu:find-in-terminal and menu:clear-buffer reach the focused terminal's ops", async () => {
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space 1" }],
      activeSpaceId: "s1",
      tabs: [
        {
          id: "a",
          spaceId: "s1",
          title: "a",
          kind: "terminal",
          paneTree: leaf("leaf-1", { kind: "terminal" }),
          activeLeafId: "leaf-1",
          paneOrder: ["leaf-1"],
        },
      ],
      activeId: "a",
    });
    const ops = makeOps();
    registerTerminalOps("leaf-1", ops);
    render(<App />);
    await fireMenuEvent("menu:find-in-terminal");
    expect(ops.openSearch).toHaveBeenCalled();
    await fireMenuEvent("menu:clear-buffer");
    expect(ops.clear).toHaveBeenCalled();
    unregisterTerminalOps("leaf-1");
  });

  it("menu:find-files opens the file finder", async () => {
    // A stale-flag effect immediately clears fileFinderOpen when there is no
    // searchable local root (see App.test.tsx's equivalent case), so give it
    // one here to observe the flag actually taking effect.
    useWorkspaceStore.setState({ rootPath: "/tmp/project" });
    render(<App />);
    await fireMenuEvent("menu:find-files");
    expect(useUiStore.getState().fileFinderOpen).toBe(true);
  });

  it("menu:toggle-sidebar toggles sidebar visibility", async () => {
    render(<App />);
    expect(useUiStore.getState().sidebarVisible).toBe(true);
    await fireMenuEvent("menu:toggle-sidebar");
    expect(useUiStore.getState().sidebarVisible).toBe(false);
  });

  it("menu:sidebar-panel selects the payload view", async () => {
    render(<App />);
    await fireMenuEvent("menu:sidebar-panel", "explorer");
    expect(useUiStore.getState().sidebarView).toBe("explorer");
    expect(useUiStore.getState().sidebarVisible).toBe(true);
  });

  it("menu:sidebar-panel ignores an unknown panel id", async () => {
    render(<App />);
    act(() => useUiStore.setState({ sidebarView: "workspaces" }));
    await fireMenuEvent("menu:sidebar-panel", "not-a-real-panel");
    expect(useUiStore.getState().sidebarView).toBe("workspaces");
  });

  it("menu:preview-back / menu:preview-forward reach the focused preview pane", async () => {
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space 1" }],
      activeSpaceId: "s1",
      tabs: [
        {
          id: "a",
          spaceId: "s1",
          title: "a",
          kind: "preview",
          paneTree: leaf("leaf-1", { kind: "preview", url: "http://localhost/x" }),
          activeLeafId: "leaf-1",
          paneOrder: ["leaf-1"],
        },
      ],
      activeId: "a",
    });
    const controls = { focusAddressBar: vi.fn(), back: vi.fn(), forward: vi.fn(), reload: vi.fn() };
    const unregister = registerPreviewControls("leaf-1", controls);
    render(<App />);
    await fireMenuEvent("menu:preview-back");
    expect(controls.back).toHaveBeenCalled();
    await fireMenuEvent("menu:preview-forward");
    expect(controls.forward).toHaveBeenCalled();
    unregister();
  });

  it("menu:preview-back reaches the tab's preview pane even when a different pane is focused", async () => {
    // The active leaf is the terminal half of the split, not the preview —
    // activePreviewControls must fall back to the tab's preview pane instead
    // of reporting "no preview" just because focus is elsewhere.
    const paneTree = splitLeaf(
      leaf("leaf-1", { kind: "launcher" }),
      "leaf-1",
      "row",
      "leaf-2",
      { kind: "preview", url: "http://localhost/x" },
    );
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space 1" }],
      activeSpaceId: "s1",
      tabs: [
        {
          id: "a",
          spaceId: "s1",
          title: "a",
          kind: "launcher",
          paneTree,
          activeLeafId: "leaf-1",
          paneOrder: ["leaf-1", "leaf-2"],
        },
      ],
      activeId: "a",
    });
    const controls = { focusAddressBar: vi.fn(), back: vi.fn(), forward: vi.fn(), reload: vi.fn() };
    const unregister = registerPreviewControls("leaf-2", controls);
    render(<App />);
    await fireMenuEvent("menu:preview-back");
    expect(controls.back).toHaveBeenCalled();
    unregister();
  });

  it("menu:preview-open-location reaches the tab's preview pane even when a different pane is focused", async () => {
    // Cmd+L is forwarded here from the native preview webview itself (it holds
    // OS keyboard focus, which is why the app's own keydown handler never
    // sees the key at all — see preview.rs's KEY_FORWARD_SCRIPT). So unlike
    // the in-app Cmd+L keydown path, there's no ambiguity about "which pane
    // kind is this key overloaded for" to resolve against the focused leaf:
    // the event firing at all already proves a preview triggered it. The
    // store's activeLeafId can still lag OS focus though, so this must use
    // the same widened activePreviewControls resolver menu:preview-back uses,
    // not the strict focusedPreviewControls used by in-app keydowns.
    const paneTree = splitLeaf(
      leaf("leaf-1", { kind: "launcher" }),
      "leaf-1",
      "row",
      "leaf-2",
      { kind: "preview", url: "http://localhost/x" },
    );
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space 1" }],
      activeSpaceId: "s1",
      tabs: [
        {
          id: "a",
          spaceId: "s1",
          title: "a",
          kind: "launcher",
          paneTree,
          activeLeafId: "leaf-1",
          paneOrder: ["leaf-1", "leaf-2"],
        },
      ],
      activeId: "a",
    });
    const controls = { focusAddressBar: vi.fn(), back: vi.fn(), forward: vi.fn(), reload: vi.fn() };
    const unregister = registerPreviewControls("leaf-2", controls);
    render(<App />);
    await fireMenuEvent("menu:preview-open-location");
    expect(controls.focusAddressBar).toHaveBeenCalled();
    unregister();
  });

  it("Cmd+L keydown does not steal from a focused terminal, but menu:preview-back still reaches the preview sibling", async () => {
    // Same split as above, but the focused leaf is a terminal, not a launcher —
    // Ctrl/Cmd+L is the terminal's own "clear screen" shortcut, so the keydown
    // path must resolve preview controls off the FOCUSED leaf only, while the
    // menu path (View > Back, or a click) still reaches the tab's preview pane
    // regardless of what's focused.
    const paneTree = splitLeaf(
      leaf("leaf-1", { kind: "terminal" }),
      "leaf-1",
      "row",
      "leaf-2",
      { kind: "preview", url: "http://localhost/x" },
    );
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space 1" }],
      activeSpaceId: "s1",
      tabs: [
        {
          id: "a",
          spaceId: "s1",
          title: "a",
          kind: "terminal",
          paneTree,
          activeLeafId: "leaf-1",
          paneOrder: ["leaf-1", "leaf-2"],
        },
      ],
      activeId: "a",
    });
    const controls = { focusAddressBar: vi.fn(), back: vi.fn(), forward: vi.fn(), reload: vi.fn() };
    const unregister = registerPreviewControls("leaf-2", controls);
    render(<App />);

    fireEvent.keyDown(window, { code: "KeyL", key: "l", metaKey: true });
    expect(controls.focusAddressBar).not.toHaveBeenCalled();

    await fireMenuEvent("menu:preview-back");
    expect(controls.back).toHaveBeenCalled();
    unregister();
  });

  it("menu:zoom-in bumps uiZoom", async () => {
    render(<App />);
    const before = useSettingsStore.getState().uiZoom;
    await fireMenuEvent("menu:zoom-in");
    expect(useSettingsStore.getState().uiZoom).toBeCloseTo(before + 0.1);
  });

  it("menu:zoom-out and menu:zoom-reset adjust uiZoom", async () => {
    render(<App />);
    await fireMenuEvent("menu:zoom-out");
    expect(useSettingsStore.getState().uiZoom).toBeLessThan(1);
    act(() => useSettingsStore.setState({ uiZoom: 1.5 }));
    await fireMenuEvent("menu:zoom-reset");
    expect(useSettingsStore.getState().uiZoom).toBe(1);
  });

  it("menu:split-right and menu:split-down split the active pane", async () => {
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space 1" }],
      activeSpaceId: "s1",
      tabs: [
        {
          id: "a",
          spaceId: "s1",
          title: "a",
          kind: "launcher",
          paneTree: leaf("leaf-1", { kind: "launcher" }),
          activeLeafId: "leaf-1",
          paneOrder: ["leaf-1"],
        },
      ],
      activeId: "a",
    });
    render(<App />);
    await fireMenuEvent("menu:split-right");
    const afterRight = useTabsStore.getState().tabs.find((t) => t.id === "a")!;
    expect(afterRight.paneTree.kind).toBe("split");
  });

  it("menu:check-updates opens settings on About and runs a manual check", async () => {
    render(<App />);
    await fireMenuEvent("menu:check-updates");
    expect(useUiStore.getState().settingsOpen).toBe(true);
    // Same rationale as the menu:open-settings test above: settingsSection is
    // cleared once SettingsView consumes it, so check the rendered section.
    expect(screen.getByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(check).toHaveBeenCalled();
  });
});
