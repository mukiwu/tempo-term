import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTabsStore } from "@/stores/tabsStore";
import {
  computeLayout,
  findPaneContent,
  leafIds,
  type PaneContent,
} from "@/modules/terminal/lib/terminalLayout";
import { useUiStore, type SidebarView } from "@/stores/uiStore";
import {
  closeWindow,
  emitWindowMenuEvent,
  minimizeWindow,
  toggleFullscreenWindow,
  toggleMaximizeWindow,
} from "@/lib/window";

const REPO_URL = "https://github.com/mukiwu/tempo-term";

export interface MenuContext {
  paneKind: PaneContent["kind"] | undefined;
  leafCount: number;
  hasPreviewPane: boolean;
  isMaximized: boolean;
  /** Icon-bar order, drag-reorderable and persisted (see uiStore.sidebarOrder).
   *  Drives the sidebar submenu's item order and ⌥N shortcut hints, so both
   *  stay in sync with the real ⌥N shortcut, which indexes into this same
   *  array (App.tsx's keydown handler). */
  sidebarOrder: SidebarView[];
}

export type MenuAction =
  | { kind: "event"; event: string; payload?: unknown }
  | { kind: "newWindow" }
  | { kind: "window"; op: "close" | "minimize" | "toggleMaximize" | "toggleFullscreen" }
  | { kind: "url"; url: string };

export interface MenuItemDef {
  id: string;
  labelKey: string;
  /** Display hint only; real shortcuts live in App.tsx keydown / native Edit menu. */
  shortcut?: { mac: string; win: string };
  /** Consecutive-group index; a divider renders between different groups. */
  group: number;
  action?: MenuAction;
  disabled?: (ctx: MenuContext) => boolean;
  submenu?: MenuItemDef[];
}

export interface MenuDef {
  id: string;
  labelKey: string;
  items: MenuItemDef[];
}

/** Snapshot of UI state the disabled() predicates need. Cheap; call on every render. */
export function getMenuContext(isMaximized: boolean): MenuContext {
  const state = useTabsStore.getState();
  const tab = state.tabs.find((t) => t.id === state.activeId);
  const content = tab ? findPaneContent(tab.paneTree, tab.activeLeafId) : undefined;
  return {
    paneKind: content?.kind,
    leafCount: tab ? leafIds(tab.paneTree).length : 0,
    hasPreviewPane: tab
      ? computeLayout(tab.paneTree).some((p) => p.content.kind === "preview")
      : false,
    isMaximized,
    sidebarOrder: useUiStore.getState().sidebarOrder,
  };
}

export function executeMenuAction(action: MenuAction): void {
  switch (action.kind) {
    case "event":
      void emitWindowMenuEvent(action.event, action.payload);
      break;
    case "newWindow":
      void invoke("open_new_window").catch(() => {});
      break;
    case "window":
      if (action.op === "close") void closeWindow();
      else if (action.op === "minimize") void minimizeWindow();
      else if (action.op === "toggleMaximize") void toggleMaximizeWindow();
      else void toggleFullscreenWindow();
      break;
    case "url":
      void openUrl(action.url).catch(() => {});
      break;
  }
}

const SIDEBAR_LABEL_KEYS: Record<SidebarView, string> = {
  workspaces: "nav.workspaces",
  explorer: "nav.explorer",
  sourceControl: "nav.git",
  notes: "nav.notes",
  ai: "nav.ai",
  connections: "nav.connections",
  sessions: "nav.sessions",
};

const notEditor = (ctx: MenuContext) => ctx.paneKind !== "editor";
const notTerminal = (ctx: MenuContext) => ctx.paneKind !== "terminal";
const noPreview = (ctx: MenuContext) => !ctx.hasPreviewPane;
const singlePane = (ctx: MenuContext) => ctx.leafCount <= 1;

export function buildMenus(ctx: MenuContext): MenuDef[] {
  return [
    {
      id: "file",
      labelKey: "menuBar.file",
      items: [
        { id: "new-tab", labelKey: "menuBar.newTab", group: 0, shortcut: { mac: "⌘T", win: "Ctrl+T" }, action: { kind: "event", event: "menu:new-tab" } },
        { id: "new-terminal-tab", labelKey: "menuBar.newTerminalTab", group: 0, shortcut: { mac: "⇧⌘T", win: "Ctrl+Shift+T" }, action: { kind: "event", event: "menu:new-terminal-tab" } },
        { id: "new-window", labelKey: "menuBar.newWindow", group: 0, shortcut: { mac: "⌘N", win: "Ctrl+N" }, action: { kind: "newWindow" } },
        { id: "save", labelKey: "menuBar.save", group: 1, shortcut: { mac: "⌘S", win: "Ctrl+S" }, action: { kind: "event", event: "menu:save" }, disabled: notEditor },
        { id: "close-tab", labelKey: "menuBar.closeTab", group: 2, shortcut: { mac: "⌘W", win: "Ctrl+W" }, action: { kind: "event", event: "menu:close-tab" } },
        { id: "close-window", labelKey: "menuBar.closeWindow", group: 2, shortcut: { mac: "⇧⌘W", win: "Ctrl+Shift+W" }, action: { kind: "window", op: "close" } },
        { id: "settings", labelKey: "menuBar.settings", group: 3, shortcut: { mac: "⌘,", win: "Ctrl+," }, action: { kind: "event", event: "menu:open-settings" } },
        { id: "rerun-setup", labelKey: "menuBar.setupWizard", group: 3, action: { kind: "event", event: "menu:rerun-setup" } },
      ],
    },
    {
      id: "edit",
      labelKey: "menuBar.edit",
      items: [
        { id: "copy", labelKey: "menuBar.copy", group: 0, shortcut: { mac: "⌘C", win: "Ctrl+C" }, action: { kind: "event", event: "menu:copy" } },
        { id: "paste", labelKey: "menuBar.paste", group: 0, shortcut: { mac: "⌘V", win: "Ctrl+V" }, action: { kind: "event", event: "menu:paste" } },
        { id: "select-all", labelKey: "menuBar.selectAll", group: 0, shortcut: { mac: "⌘A", win: "Ctrl+A" }, action: { kind: "event", event: "menu:select-all" } },
        { id: "find-in-terminal", labelKey: "menuBar.findInTerminal", group: 1, shortcut: { mac: "⌘F", win: "Ctrl+Shift+F" }, action: { kind: "event", event: "menu:find-in-terminal" }, disabled: notTerminal },
        { id: "find-files", labelKey: "menuBar.findFiles", group: 1, shortcut: { mac: "⌘P", win: "Ctrl+P" }, action: { kind: "event", event: "menu:find-files" } },
      ],
    },
    {
      id: "view",
      labelKey: "menuBar.view",
      items: [
        { id: "toggle-sidebar", labelKey: "menuBar.toggleSidebar", group: 0, shortcut: { mac: "⌘B", win: "Ctrl+B" }, action: { kind: "event", event: "menu:toggle-sidebar" } },
        {
          id: "sidebar-panel",
          labelKey: "menuBar.sidebarPanel",
          group: 0,
          submenu: ctx.sidebarOrder.map((view, index) => ({
            id: `sidebar-${view}`,
            labelKey: SIDEBAR_LABEL_KEYS[view],
            group: 0,
            shortcut: { mac: `⌥${index + 1}`, win: `Alt+${index + 1}` },
            action: { kind: "event" as const, event: "menu:sidebar-panel", payload: view },
          })),
        },
        { id: "preview-back", labelKey: "menuBar.previewBack", group: 1, shortcut: { mac: "⌘[", win: "Ctrl+[" }, action: { kind: "event", event: "menu:preview-back" }, disabled: noPreview },
        { id: "preview-forward", labelKey: "menuBar.previewForward", group: 1, shortcut: { mac: "⌘]", win: "Ctrl+]" }, action: { kind: "event", event: "menu:preview-forward" }, disabled: noPreview },
        { id: "zoom-in", labelKey: "menuBar.zoomIn", group: 2, shortcut: { mac: "⌘+", win: "Ctrl++" }, action: { kind: "event", event: "menu:zoom-in" } },
        { id: "zoom-out", labelKey: "menuBar.zoomOut", group: 2, shortcut: { mac: "⌘-", win: "Ctrl+-" }, action: { kind: "event", event: "menu:zoom-out" } },
        { id: "zoom-reset", labelKey: "menuBar.resetZoom", group: 2, shortcut: { mac: "⌘0", win: "Ctrl+0" }, action: { kind: "event", event: "menu:zoom-reset" } },
      ],
    },
    {
      id: "terminal",
      labelKey: "menuBar.terminal",
      items: [
        { id: "split-right", labelKey: "menuBar.splitRight", group: 0, shortcut: { mac: "⌘D", win: "Ctrl+D" }, action: { kind: "event", event: "menu:split-right" } },
        { id: "split-down", labelKey: "menuBar.splitDown", group: 0, shortcut: { mac: "⇧⌘D", win: "Ctrl+Shift+D" }, action: { kind: "event", event: "menu:split-down" } },
        { id: "cycle-pane", labelKey: "menuBar.cyclePane", group: 0, shortcut: { mac: "⌘`", win: "Ctrl+`" }, action: { kind: "event", event: "menu:focus-next-pane" }, disabled: singlePane },
        { id: "clear-buffer", labelKey: "menuBar.clearBuffer", group: 1, action: { kind: "event", event: "menu:clear-buffer" }, disabled: notTerminal },
      ],
    },
    {
      id: "window",
      labelKey: "menuBar.window",
      items: [
        { id: "minimize", labelKey: "titleBar.minimize", group: 0, action: { kind: "window", op: "minimize" } },
        { id: "toggle-maximize", labelKey: ctx.isMaximized ? "titleBar.restore" : "titleBar.maximize", group: 0, action: { kind: "window", op: "toggleMaximize" } },
        { id: "toggle-fullscreen", labelKey: "menuBar.toggleFullScreen", group: 0, action: { kind: "window", op: "toggleFullscreen" } },
      ],
    },
    {
      id: "help",
      labelKey: "menuBar.help",
      items: [
        { id: "documentation", labelKey: "menuBar.documentation", group: 0, action: { kind: "url", url: `${REPO_URL}#readme` } },
        { id: "keyboard-shortcuts", labelKey: "menuBar.keyboardShortcuts", group: 0, action: { kind: "event", event: "menu:open-settings", payload: "shortcuts" } },
        { id: "report-issue", labelKey: "menuBar.reportIssue", group: 0, action: { kind: "url", url: `${REPO_URL}/issues` } },
        { id: "check-updates", labelKey: "menuBar.checkForUpdates", group: 1, action: { kind: "event", event: "menu:check-updates" } },
        { id: "about", labelKey: "menuBar.about", group: 1, action: { kind: "event", event: "menu:open-settings", payload: "about" } },
      ],
    },
  ];
}
