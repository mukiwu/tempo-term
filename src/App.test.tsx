import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import "./i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf, splitLeaf, type LayoutNode } from "@/modules/terminal/lib/terminalLayout";

// "Close Tab" clicked in the WindowMenuBar's File menu delivers a
// `menu:close-tab` event to this webview's scoped listener. Capture that
// handler so tests can fire the menu-driven path independently of the
// keyboard-driven ⌘W handled directly in App.tsx's keydown handler.
const menuBridge = vi.hoisted(() => ({ closeTab: null as null | (() => void) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    setZoom: () => Promise.resolve(),
    listen: (event: string, handler: () => void) => {
      if (event === "menu:close-tab") {
        menuBridge.closeTab = handler;
      }
      return Promise.resolve(() => {});
    },
  }),
}));

// TitleBar now renders on every platform (not just Windows — see Task 3), and
// its WindowMenuBar tracks maximize state via a real Tauri window call that
// jsdom has no backend for. These tests exercise App-level behavior, not the
// title bar, so stub it out (same stub App.windows.test.tsx uses).
vi.mock("@/components/TitleBar", () => ({ TitleBar: () => null }));

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
    useWorkspaceStore.setState({ rootPath: null });
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
      paneOrder: [`${id}-leaf`],
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
          paneOrder: ["left-leaf", "right-leaf"],
        },
      ],
      activeId: "a",
    });
    render(<App />);

    // Fire ⌘W via the menu bridge (the only path — see App.tsx), exactly once.
    act(() => menuBridge.closeTab?.());

    const tab = useTabsStore.getState().tabs.find((t) => t.id === "a");
    expect(tab?.paneTree).toEqual(leaf("right-leaf", { kind: "launcher" }));
  });

  it("closes exactly one pane per trigger, keydown and menu-click alike (no double-close)", () => {
    // Three stacked launcher panes; each ⌘W trigger must peel exactly one, not
    // cascade. The keyboard press (App.tsx keydown) and the WindowMenuBar's
    // "Close Tab" click (menuBridge) are two independent user gestures — see
    // Task 3 — so each is fired once here and must close exactly one pane.
    const twoPanes = splitLeaf(leaf("p1", { kind: "launcher" }), "p1", "row", "p2", {
      kind: "launcher",
    });
    const paneTree = splitLeaf(twoPanes, "p2", "row", "p3", { kind: "launcher" });
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
          activeLeafId: "p1",
          paneOrder: ["p1", "p2", "p3"],
        },
      ],
      activeId: "a",
    });
    render(<App />);

    const paneCount = (tree: LayoutNode): number =>
      tree.kind === "split" ? paneCount(tree.children[0]) + paneCount(tree.children[1]) : 1;

    // A single keydown of ⌘W closes exactly one pane, leaving two.
    fireEvent.keyDown(window, { code: "KeyW", key: "w", metaKey: true });
    let tab = useTabsStore.getState().tabs.find((t) => t.id === "a");
    expect(paneCount(tab!.paneTree)).toBe(2);

    // A separate menu-driven ⌘W (WindowMenuBar's "Close Tab" click) closes one
    // more, leaving one — not two closed at once.
    act(() => menuBridge.closeTab?.());
    tab = useTabsStore.getState().tabs.find((t) => t.id === "a");
    expect(paneCount(tab!.paneTree)).toBe(1);
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
      paneOrder: [`${id}-leaf`],
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

  it("clears a stale file-search flag left over from before a folder was opened", () => {
    // Cmd/Ctrl+P pressed with no folder open (or a remote one) sets
    // fileFinderOpen without anywhere to render it — if that flag survives
    // until the user later opens a searchable folder, the palette would pop
    // up unprompted. It must self-clear instead.
    useWorkspaceStore.setState({ rootPath: null });
    useUiStore.setState({ fileFinderOpen: true });

    render(<App />);

    expect(useUiStore.getState().fileFinderOpen).toBe(false);
  });
});
