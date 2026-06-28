import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TabBar } from "@/components/TabBar";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar, SIDEBAR_VIEW_ORDER } from "@/components/Sidebar";
import { Resizer } from "@/components/Resizer";
import { StatusBar } from "@/components/StatusBar";
import { SettingsModal } from "@/components/SettingsModal";
import { UpdateModal } from "@/components/UpdateModal";
import { UpdateToast } from "@/components/UpdateToast";
import { TabsArea } from "@/components/TabsArea";
import { useUiStore } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabsStore, tabHasDirtyEditor } from "@/stores/tabsStore";
import { useEditorStore } from "@/modules/editor/store/editorStore";
import { installEditorBufferSync } from "@/modules/editor/lib/syncBuffers";
import { installEditorWatchSync } from "@/modules/editor/lib/editorWatch";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { pruneTerminalHistory } from "@/modules/terminal/lib/terminalHistory";
import { leafIds } from "@/modules/terminal/lib/terminalLayout";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { applyTheme, getTheme } from "@/themes/themes";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useProgressStore } from "@/modules/claude-progress/lib/progressStore";
import { useWatchSessions } from "@/modules/claude-progress/lib/useWatchSessions";
import { installStatusHook, installCodexStatusHook } from "@/modules/claude-progress/lib/statusHookBridge";
import { installSessionNotifications } from "@/modules/claude-progress/lib/sessionNotifications";
import { ensureNotificationPermission } from "@/modules/claude-progress/lib/notify";
import { useWatchNotes } from "@/modules/notes/lib/useWatchNotes";
import { registerSecondaryWindowCleanup } from "@/lib/windowLifecycle";
import { SshPromptDialog } from "@/modules/ssh/SshPromptDialog";
import { useForwardStatusListener } from "@/modules/ssh/lib/useForwardStatus";
import { sftpSessionStore } from "@/modules/ssh/lib/sftpSessionStore";
import { enforceLogRetention } from "@/modules/logs/lib/sessionLog";

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 640;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The 1-9 a number-row key represents, read from `code` rather than `key` so it
 * survives modifiers that rewrite the character — on macOS ⌥1 yields "¡", not
 * "1". Returns null for any non-1-9 key.
 */
function digitFromCode(code: string): number | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return match ? Number(match[1]) : null;
}

/**
 * True when a key event originates from somewhere the user is typing — a text
 * input, textarea, or contentEditable — so window-level navigation/zoom
 * shortcuts yield and let the character through (⌥1 types "¡" in the AI box, the
 * file finder, etc.). The terminal's own hidden textarea is excluded: TerminalView
 * deliberately forwards app shortcuts up to this handler, so a focused terminal
 * must still trigger them.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest(".xterm")) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function App() {
  const { t } = useTranslation();
  const themeId = useSettingsStore((s) => s.themeId);
  const uiZoom = useSettingsStore((s) => s.uiZoom);
  const sidebarVisible = useUiStore((s) => s.sidebarVisible);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [pendingCloseAction, setPendingCloseAction] = useState<(() => void) | null>(null);

  useWatchSessions();
  useWatchNotes();
  useForwardStatusListener();

  useEffect(() => {
    applyTheme(getTheme(themeId), document.documentElement);
  }, [themeId]);

  // Scale the whole webview to the saved zoom (driven by ⌘+ / ⌘- / ⌘0). Native
  // webview zoom keeps the terminal's sizing math intact, unlike a CSS scale.
  // getCurrentWebview() throws without a Tauri runtime (tests, web preview), so
  // guard the whole call.
  useEffect(() => {
    try {
      void getCurrentWebview().setZoom(uiZoom).catch(() => {});
    } catch {
      // No Tauri webview available; nothing to zoom.
    }
  }, [uiZoom]);

  // The font report (enumerating every installed family) is loaded lazily by
  // the Fonts settings section when it opens, not at startup — the terminal's
  // default font chain already covers CJK, so a cold launch does no font work.

  // Drop saved terminal scrollback for panes that no longer exist (orphans
  // left by closed tabs/panes), keeping only the panes still in the layout.
  useEffect(() => {
    const keep = useTabsStore.getState().tabs.flatMap((t) => leafIds(t.paneTree));
    void pruneTerminalHistory(keep).catch(() => {});
  }, []);

  // Forget an editor buffer once its file leaves every tab/pane, so closing a
  // file without saving discards the edit instead of resurrecting it on reopen.
  useEffect(() => installEditorBufferSync(), []);

  // Watch the files open in editor tabs so external edits (e.g. an AI agent
  // editing a file) can reload it without closing and reopening the tab.
  useEffect(() => installEditorWatchSync(), []);

  // Prune session logs older than the configured retention window once on
  // startup so disk usage stays bounded without waiting for the panel to open.
  useEffect(() => {
    // Best-effort cleanup; a failure here must never surface as an unhandled rejection.
    void enforceLogRetention(useSettingsStore.getState().logRetentionDays).catch(() => {});
  }, []);

  // In a secondary window, close this window's PTY sessions before it is
  // destroyed so no background shells leak. No-op in the main window.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void registerSecondaryWindowCleanup()
      .then((off) => {
        unlisten = off;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Close any open SFTP connections when this window goes away so no remote
  // connection leaks.
  useEffect(() => {
    return () => sftpSessionStore.getState().closeAll();
  }, []);

  // Keep the Claude session-status hook installed when tracking is enabled, so
  // workspace cards reflect the live CLI. Idempotent; a failure retries next launch.
  useEffect(() => {
    if (useSettingsStore.getState().claudeStatusTracking) {
      void installStatusHook().catch(() => {});
      void installCodexStatusHook().catch(() => {});
    }
  }, []);

  // Raise a desktop notification when a tracked agent needs approval or finishes
  // while the window is unfocused. Prime the OS permission up front so the first
  // real notification isn't swallowed by a permission prompt.
  useEffect(() => {
    if (useSettingsStore.getState().claudeNotifications) {
      void ensureNotificationPermission();
    }
    return installSessionNotifications();
  }, []);

  // Quietly check for a new release a few seconds after launch; the modal only
  // appears if one actually exists, so a normal start stays uninterrupted.
  useEffect(() => {
    const timer = setTimeout(() => {
      void useUpdaterStore.getState().runLaunchCheck();
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // While the app stays open, re-check on a fixed cadence so a release published
  // mid-session is surfaced without a restart. A hit toasts once per version.
  useEffect(() => {
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const timer = setInterval(() => {
      void useUpdaterStore.getState().runPeriodicCheck();
    }, SIX_HOURS);
    return () => clearInterval(timer);
  }, []);

  // Stream Claude Code progress: the backend watcher emits appended transcript
  // lines, which we feed through the normalizer into the progress store.
  useEffect(() => {
    // listen() rejects when there is no Tauri runtime (unit tests, web preview);
    // swallow it so it never surfaces as an unhandled rejection.
    const unlisten = listen<{ cwd: string; agent: "claude" | "codex"; lines: string[]; reset: boolean }>(
      "claude-progress:lines",
      (event) => {
        const { cwd, agent, lines, reset } = event.payload;
        useProgressStore.getState().pushLines(cwd, agent, lines, reset);
      },
    ).catch(() => undefined);
    return () => {
      void unlisten.then((off) => off?.());
    };
  }, []);

  // Global keyboard shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const digit = digitFromCode(e.code);
      // Tab/sidebar/zoom/pane shortcuts yield while the user is typing in a text
      // field (the terminal is excluded — see isEditableTarget).
      const editable = isEditableTarget(e.target);

      // ⌥1…⌥7 jump straight to a sidebar panel by its position in the icon bar.
      if (digit !== null && e.altKey && !e.metaKey && !e.ctrlKey && !editable) {
        const view = SIDEBAR_VIEW_ORDER[digit - 1];
        if (view) {
          e.preventDefault();
          useUiStore.getState().selectSidebar(view);
        }
        return;
      }

      if (!(e.metaKey || e.ctrlKey)) {
        return;
      }

      // ⌘1…⌘9 switch to the Nth tab of the active space (matching the tab bar).
      if (digit !== null && !e.shiftKey && !e.altKey && !editable) {
        const state = useTabsStore.getState();
        const spaceTabs = state.tabs.filter((t) => t.spaceId === state.activeSpaceId);
        const target = spaceTabs[digit - 1];
        if (target) {
          e.preventDefault();
          state.setActive(target.id);
        }
        return;
      }

      // ⌘` cycles focus through the panes of the active tab (⌘~ works too, since
      // both sit on the Backquote key). No-op with one pane.
      if (e.code === "Backquote" && !e.altKey && !editable) {
        e.preventDefault();
        useTabsStore.getState().focusNextPane();
        return;
      }

      // Zoom the whole UI. `code` is used so it works regardless of layout/Shift:
      // the "=" key (⌘= or ⌘+) zooms in, "-" zooms out, "0" resets to 100%.
      if (!e.altKey && !editable) {
        if (e.code === "Equal" || e.code === "NumpadAdd") {
          e.preventDefault();
          useSettingsStore.getState().zoomIn();
          return;
        }
        if (e.code === "Minus" || e.code === "NumpadSubtract") {
          e.preventDefault();
          useSettingsStore.getState().zoomOut();
          return;
        }
        if (e.code === "Digit0" || e.code === "Numpad0") {
          e.preventDefault();
          useSettingsStore.getState().resetZoom();
          return;
        }
      }

      const key = e.key.toLowerCase();
      if (key === "t") {
        e.preventDefault();
        // ⇧⌘T opens a terminal straight away; ⌘T opens the launcher.
        if (e.shiftKey) {
          useTabsStore
            .getState()
            .newTerminalTab(useWorkspaceStore.getState().rootPath ?? undefined);
        } else {
          useTabsStore.getState().openLauncherTab();
        }
      } else if (key === "w") {
        e.preventDefault();
        const tabsState = useTabsStore.getState();
        const tab = tabsState.tabs.find((t) => t.id === tabsState.activeId);
        if (!tab) {
          return;
        }
        const panes = computeLayout(tab.paneTree);
        const buffers = useEditorStore.getState().buffers;
        if (panes.length <= 1) {
          if (tabHasDirtyEditor(tab, buffers)) {
            setPendingCloseAction(() => () => tabsState.closeTab(tab.id));
          } else {
            tabsState.closePaneOrTab();
          }
        } else {
          // Close the currently focused pane; fall back to the bottom-right
          // pane if the active leaf is somehow stale.
          const target =
            panes.find((p) => p.id === tab.activeLeafId) ??
            panes.reduce((a, b) => {
              if (b.rect.top !== a.rect.top) return b.rect.top > a.rect.top ? b : a;
              return b.rect.left > a.rect.left ? b : a;
            });
          const targetBuf =
            target.content.kind === "editor" ? buffers[target.content.path] : undefined;
          const targetDirty = targetBuf ? targetBuf.content !== targetBuf.baseline : false;
          if (targetDirty) {
            setPendingCloseAction(() => () => tabsState.closePane(tab.id, target.id));
          } else {
            tabsState.closePane(tab.id, target.id);
          }
        }
      } else if (key === "p") {
        e.preventDefault();
        useUiStore.getState().openFileFinder();
      } else if (key === "b") {
        e.preventDefault();
        useUiStore.getState().toggleSidebar();
      } else if (key === ",") {
        e.preventDefault();
        useUiStore.getState().setSettingsOpen(true);
      } else if (key === "d") {
        // ⌘D splits left/right, ⌘⇧D splits top/bottom (no-op off a terminal tab).
        e.preventDefault();
        useTabsStore.getState().splitActivePane(e.shiftKey ? "col" : "row");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg">
      <TitleBar />
      <TabBar />

      <div className="flex min-h-0 flex-1">
        {sidebarVisible && (
          <>
            <div style={{ width: sidebarWidth }} className="h-full shrink-0">
              <Sidebar />
            </div>
            <Resizer
              orientation="vertical"
              onResize={(d) => setSidebarWidth((w) => clamp(w + d, MIN_SIDEBAR, MAX_SIDEBAR))}
            />
          </>
        )}

        <main className="min-w-0 flex-1 overflow-hidden">
          <TabsArea />
        </main>
      </div>

      <StatusBar />
      {settingsOpen && <SettingsModal />}
      <UpdateModal />
      <UpdateToast />
      <SshPromptDialog />
      {pendingCloseAction && (
        <ConfirmDialog
          title={t("editor:closeUnsavedTitle")}
          message={t("editor:closeUnsavedMessage")}
          confirmLabel={t("editor:discardClose")}
          cancelLabel={t("actions.cancel")}
          onConfirm={() => {
            pendingCloseAction();
            setPendingCloseAction(null);
          }}
          onCancel={() => setPendingCloseAction(null)}
        />
      )}
    </div>
  );
}

export default App;
