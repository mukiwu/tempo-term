import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TabBar } from "@/components/TabBar";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar } from "@/components/Sidebar";
import { Resizer } from "@/components/Resizer";
import { StatusBar } from "@/components/StatusBar";
import { SettingsModal } from "@/components/SettingsModal";
import { UpdateModal } from "@/components/UpdateModal";
import { UpdateToast } from "@/components/UpdateToast";
import { NotifyToast } from "@/components/NotifyToast";
import { TabsArea } from "@/components/TabsArea";
import { useUiStore, type SidebarView } from "@/stores/uiStore";
import { useFontStore, shouldPrefetchFontReport } from "@/stores/fontStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabsStore, tabHasDirtyEditor } from "@/stores/tabsStore";
import { useEditorStore } from "@/modules/editor/store/editorStore";
import { installEditorBufferSync } from "@/modules/editor/lib/syncBuffers";
import { installEditorWatchSync } from "@/modules/editor/lib/editorWatch";
import { saveFocusedEditor } from "@/modules/editor/lib/editorBus";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { pruneTerminalHistory } from "@/modules/terminal/lib/terminalHistory";
import { findPaneContent, leafIds } from "@/modules/terminal/lib/terminalLayout";
import { focusedTerminalOps } from "@/modules/terminal/lib/terminalBus";
import { getPreviewControls, type PreviewControls } from "@/modules/preview/lib/previewControls";
import { menuCopy, menuPaste, menuSelectAll } from "@/lib/editActions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FileFinder } from "@/modules/explorer/FileFinder";
import { canSearchRoot } from "@/modules/explorer/lib/fsBridge";
import { applyTheme, getTheme } from "@/themes/themes";
import { listen, type Event as TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useProgressStore } from "@/modules/claude-progress/lib/progressStore";
import { useWatchSessions } from "@/modules/claude-progress/lib/useWatchSessions";
import { installStatusHook, installCodexStatusHook } from "@/modules/claude-progress/lib/statusHookBridge";
import { installSessionNotifications } from "@/modules/claude-progress/lib/sessionNotifications";
import { ensureNotificationPermission } from "@/modules/claude-progress/lib/notify";
import { useWatchNotes } from "@/modules/notes/lib/useWatchNotes";
import { registerSecondaryWindowCleanup } from "@/lib/windowLifecycle";
import { SshPromptDialog } from "@/modules/ssh/SshPromptDialog";
import { SetupWizard } from "@/modules/setup/SetupWizard";
import { detectTools, isToolReady } from "@/modules/setup/lib/setupTools";
import { isMainWindow, closeWindow } from "@/lib/window";
import { IS_WINDOWS } from "@/lib/platform";
import { invoke } from "@tauri-apps/api/core";
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

/**
 * Controls for the preview pane the View menu's Back/Forward items (and the
 * `menu:preview-back` / `menu:preview-forward` events they emit) should reach:
 * the active tab's focused leaf when it is itself a preview, otherwise the
 * tab's first preview pane (a preview can exist in a split without holding
 * focus — e.g. the user is typing in a sibling terminal/editor pane).
 * undefined when the active tab has no preview pane at all.
 *
 * Deliberately used ONLY by the menu listeners: their `disabled` predicate
 * (`hasPreviewPane`/`noPreview` in menuBarMenus.ts) already gates on "does this
 * tab have a preview pane anywhere", not "is a preview focused", so the action
 * they fire must resolve the same way or a click on an enabled menu item could
 * silently no-op. The keydown paths below use the stricter
 * `focusedPreviewControls` instead — see its doc comment for why.
 */
function activePreviewControls(): PreviewControls | undefined {
  const state = useTabsStore.getState();
  const tab = state.tabs.find((tt) => tt.id === state.activeId);
  if (!tab) {
    return undefined;
  }
  const focused = findPaneContent(tab.paneTree, tab.activeLeafId);
  if (focused?.kind === "preview") {
    return getPreviewControls(tab.activeLeafId);
  }
  const previewLeaf = computeLayout(tab.paneTree).find((p) => p.content.kind === "preview");
  return previewLeaf ? getPreviewControls(previewLeaf.id) : undefined;
}

/**
 * Controls for the preview pane the FOCUSED leaf itself is — undefined
 * whenever the focused leaf isn't a preview, even if a preview pane exists
 * elsewhere in the same tab's split. Used by every keydown shortcut that
 * doubles as something else on a non-preview pane: Ctrl/Cmd+L is a terminal's
 * "clear screen", and Cmd+[ / Cmd+] are an editor's indent/outdent. Widening
 * this the way `activePreviewControls` does for the menu items would steal
 * those keys from whichever pane the user is actually typing into.
 */
function focusedPreviewControls(): PreviewControls | undefined {
  const state = useTabsStore.getState();
  const tab = state.tabs.find((tt) => tt.id === state.activeId);
  if (!tab) {
    return undefined;
  }
  const focused = findPaneContent(tab.paneTree, tab.activeLeafId);
  return focused?.kind === "preview" ? getPreviewControls(tab.activeLeafId) : undefined;
}

/**
 * Subscribe to a backend event scoped to this window's webview, returning a
 * cleanup for useEffect. Race-safe under React StrictMode: listen() is async, so
 * the cleanup awaits its promise before unsubscribing — a mount→unmount→mount
 * cycle can never leak a duplicate listener. A leaked duplicate is what made one
 * ⌘W close two tabs at once. No-op when there is no Tauri webview (unit tests).
 */
function listenWebview<T = unknown>(event: string, handler: (event: TauriEvent<T>) => void): () => void {
  let promise: Promise<(() => void) | undefined> | null = null;
  try {
    promise = getCurrentWebview()
      .listen<T>(event, handler)
      .catch(() => undefined);
  } catch {
    // No Tauri webview available (unit tests / web preview).
  }
  return () => {
    void promise?.then((off) => off?.());
  };
}

function App() {
  const { t } = useTranslation();
  const themeId = useSettingsStore((s) => s.themeId);
  const uiZoom = useSettingsStore((s) => s.uiZoom);
  const sidebarVisible = useUiStore((s) => s.sidebarVisible);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setupWizardOpen = useUiStore((s) => s.setupWizardOpen);
  const setSetupWizardOpen = useUiStore((s) => s.setSetupWizardOpen);
  const fileFinderOpen = useUiStore((s) => s.fileFinderOpen);
  const setFileFinderOpen = useUiStore((s) => s.setFileFinderOpen);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [pendingCloseAction, setPendingCloseAction] = useState<(() => void) | null>(null);

  // Cmd/Ctrl+P with no open folder (or a remote one) sets fileFinderOpen with
  // nowhere to render it — left alone, that flag would survive until the user
  // later opens a searchable folder and the palette would pop up unprompted.
  // Clear it as soon as it stops having anywhere to render.
  useEffect(() => {
    if (fileFinderOpen && !canSearchRoot(rootPath)) {
      setFileFinderOpen(false);
    }
  }, [fileFinderOpen, rootPath, setFileFinderOpen]);

  // Close the focused pane, or the whole tab when it holds a single pane. Shared
  // by the ⌘W key handler and the "Close Tab" menu item (both must behave the
  // same, and a dirty editor routes through the unsaved-changes confirmation).
  const closeActiveTabOrPane = useCallback(() => {
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
  }, []);

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
  // One exception (#164): icon-font auto-detect has no static fallback list
  // (unlike CJK), so on the very first launch ever — auto mode with no cached
  // suggestion — the report is loaded once off the critical path, at idle.
  // Its suggestion then persists (fontStore.cachedIconFallback), so every
  // later launch is back to zero font work and Nerd Font glyphs still render.
  useEffect(() => {
    if (!shouldPrefetchFontReport(useFontStore.getState())) {
      return;
    }
    let cancelled = false;
    const run = () => {
      if (!cancelled) {
        void useFontStore.getState().loadReport();
      }
    };
    // requestIdleCallback is missing on older WKWebView; a delayed timeout is
    // an acceptable "idle" stand-in for a one-time prefetch.
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run);
    } else {
      window.setTimeout(run, 2000);
    }
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Prune session logs older than 30 days on startup so disk usage stays
  // bounded without waiting for anything else to trigger the sweep.
  useEffect(() => {
    // Best-effort cleanup; a failure here must never surface as an unhandled rejection.
    void enforceLogRetention(30).catch(() => {});
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
        const view = useUiStore.getState().sidebarOrder[digit - 1];
        if (view) {
          e.preventDefault();
          useUiStore.getState().selectSidebar(view);
        }
        return;
      }

      if (!(e.metaKey || e.ctrlKey)) {
        return;
      }

      // On Windows the app's shortcut modifier is Ctrl; `metaKey` is the Windows
      // key, whose system combos (Win+D, Win+E, Win+W, …) must never trigger an
      // app shortcut. Reject them here so neither the primary-modifier block nor
      // the shared letter handlers below can misfire on a Win+key press. (macOS
      // uses Cmd = metaKey, so this is Windows-only.)
      if (IS_WINDOWS && e.metaKey) {
        return;
      }

      // Neither platform's native menu carries these shortcuts anymore: Windows
      // never had a native menu bar (the frame is hidden in favor of the custom
      // React title bar), and the macOS menu is now reduced to the system
      // minimum (App + Edit only — see menu.rs). The webview keydown handler is
      // the single source of truth for them on both platforms, gated on each
      // platform's primary modifier (Ctrl on Windows, Cmd elsewhere) so the two
      // gates never overlap. `code` is used so it matches regardless of keyboard
      // layout.
      const primaryMod = IS_WINDOWS ? e.ctrlKey : e.metaKey;
      if (primaryMod && !e.altKey) {
        // W closes the active tab/pane; Shift+W closes the window.
        if (e.code === "KeyW") {
          e.preventDefault();
          if (e.shiftKey) {
            void closeWindow();
          } else {
            closeActiveTabOrPane();
          }
          return;
        }
        // ` cycles focus through the active tab's panes.
        if (e.code === "Backquote" && !e.shiftKey) {
          e.preventDefault();
          useTabsStore.getState().focusNextPane();
          return;
        }
        // N opens a new window (mirrors File > New Window).
        if (e.code === "KeyN" && !e.shiftKey) {
          e.preventDefault();
          void invoke("open_new_window").catch(() => {});
          return;
        }
        // L focuses the active preview's address bar. Only acts on a preview
        // pane, so a focused terminal keeps the primary-modifier+L shortcut
        // (clear screen).
        if (e.code === "KeyL" && !e.shiftKey) {
          const controls = focusedPreviewControls();
          if (controls) {
            e.preventDefault();
            controls.focusAddressBar();
          }
          return;
        }
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

      // ⌘[ / ⌘] step the active preview's history back/forward. Only acts on a
      // preview pane, so editors/terminals keep these keys. (When the native
      // preview webview holds focus, an injected script handles them instead —
      // this covers the case where the app webview has focus.)
      if ((e.code === "BracketLeft" || e.code === "BracketRight") && !e.altKey && !e.shiftKey) {
        const controls = focusedPreviewControls();
        if (controls) {
          e.preventDefault();
          if (e.code === "BracketLeft") {
            controls.back();
          } else {
            controls.forward();
          }
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
      } else if (key === "p") {
        e.preventDefault();
        useUiStore.getState().openFileFinder();
      } else if (key === "b") {
        e.preventDefault();
        useUiStore.getState().toggleSidebar();
      } else if (key === ",") {
        e.preventDefault();
        useUiStore.getState().openSettings();
      } else if (key === "d") {
        // ⌘D splits left/right, ⌘⇧D splits top/bottom (no-op off a terminal tab).
        e.preventDefault();
        useTabsStore.getState().splitActivePane(e.shiftKey ? "col" : "row");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeActiveTabOrPane]);

  // Closes the active tab/pane when "Close Tab" is clicked in the self-drawn
  // WindowMenuBar (menuBarMenus.ts) — a click, not a keydown, so this never
  // double-fires with the primary-modifier+W keydown handler above.
  // `emitWindowMenuEvent` scopes the emit to this window's label, so clicking
  // Close Tab in one window never closes a tab in another.
  useEffect(
    () => listenWebview("menu:close-tab", () => closeActiveTabOrPane()),
    [closeActiveTabOrPane],
  );

  // Cycles focus through the active tab's panes when "Cycle Pane" is clicked in
  // the WindowMenuBar's Terminal menu — the keyboard path (primary-modifier+`)
  // is handled directly in the keydown handler above.
  useEffect(
    () => listenWebview("menu:focus-next-pane", () => useTabsStore.getState().focusNextPane()),
    [],
  );

  // Re-open the setup wizard from the File menu (works in any window).
  useEffect(
    () => listenWebview("menu:rerun-setup", () => setSetupWizardOpen(true)),
    [setSetupWizardOpen],
  );

  // The rest of menuBarMenus.ts's `menu:*` events, each delegating straight to
  // an existing store action / bus so the menu bar, its keyboard accelerators,
  // and the Windows custom title-bar menu all drive the exact same behavior.
  useEffect(() => {
    const unlistens = [
      listenWebview("menu:new-tab", () => {
        useTabsStore.getState().openLauncherTab();
      }),
      listenWebview("menu:new-terminal-tab", () => {
        useTabsStore.getState().newTerminalTab(useWorkspaceStore.getState().rootPath ?? undefined);
      }),
      listenWebview("menu:save", () => {
        saveFocusedEditor();
      }),
      listenWebview("menu:open-settings", (event) => {
        useUiStore.getState().openSettings(typeof event.payload === "string" ? event.payload : undefined);
      }),
      listenWebview("menu:copy", () => {
        void menuCopy().catch(() => {});
      }),
      listenWebview("menu:paste", () => {
        void menuPaste().catch(() => {});
      }),
      listenWebview("menu:select-all", () => {
        menuSelectAll();
      }),
      listenWebview("menu:find-in-terminal", () => {
        focusedTerminalOps()?.openSearch();
      }),
      listenWebview("menu:find-files", () => {
        useUiStore.getState().openFileFinder();
      }),
      listenWebview("menu:toggle-sidebar", () => {
        useUiStore.getState().toggleSidebar();
      }),
      listenWebview("menu:sidebar-panel", (event) => {
        const view = event.payload as SidebarView;
        if (useUiStore.getState().sidebarOrder.includes(view)) {
          useUiStore.getState().selectSidebar(view);
        }
      }),
      listenWebview("menu:preview-back", () => {
        activePreviewControls()?.back();
      }),
      listenWebview("menu:preview-forward", () => {
        activePreviewControls()?.forward();
      }),
      // Forwarded from the native preview webview itself when it holds OS
      // keyboard focus (see preview.rs's KEY_FORWARD_SCRIPT) — the event
      // firing at all already proves a preview pane triggered it, so unlike
      // the in-app Cmd+L keydown handler there's no other pane kind this key
      // could mean instead. Use the widened activePreviewControls the same
      // way menu:preview-back does: the store's activeLeafId can lag behind
      // which pane actually holds native focus.
      listenWebview("menu:preview-open-location", () => {
        activePreviewControls()?.focusAddressBar();
      }),
      listenWebview("menu:zoom-in", () => {
        useSettingsStore.getState().zoomIn();
      }),
      listenWebview("menu:zoom-out", () => {
        useSettingsStore.getState().zoomOut();
      }),
      listenWebview("menu:zoom-reset", () => {
        useSettingsStore.getState().resetZoom();
      }),
      listenWebview("menu:split-right", () => {
        useTabsStore.getState().splitActivePane("row");
      }),
      listenWebview("menu:split-down", () => {
        useTabsStore.getState().splitActivePane("col");
      }),
      listenWebview("menu:clear-buffer", () => {
        focusedTerminalOps()?.clear();
      }),
      // "Check for Updates" also opens Settings on the About section, where
      // the update status/progress lives — the same destination as the Help
      // menu's About item, just with a check kicked off immediately.
      listenWebview("menu:check-updates", () => {
        useUiStore.getState().openSettings("about");
        void useUpdaterStore.getState().checkManually();
      }),
    ];
    return () => unlistens.forEach((off) => off());
  }, []);

  // Auto-open the setup wizard on the very first launch. Gated to the main
  // window: secondary windows use isolated in-memory storage, so their
  // onboardingCompleted is always false and would otherwise re-trigger it.
  // If every tool is already installed (e.g. an existing user upgrading to the
  // version that adds this flag), silently mark onboarding done instead of
  // interrupting them. Detection failure falls back to showing the wizard.
  useEffect(() => {
    if (!isMainWindow() || useSettingsStore.getState().onboardingCompleted) {
      return;
    }
    let cancelled = false;
    void detectTools()
      .then((res) => {
        if (cancelled) return;
        const allReady = res.tools.length > 0 && res.tools.every(isToolReady);
        if (allReady) {
          useSettingsStore.getState().setOnboardingCompleted(true);
        } else {
          setSetupWizardOpen(true);
        }
      })
      .catch(() => {
        if (!cancelled) setSetupWizardOpen(true);
      });
    return () => {
      cancelled = true;
    };
  }, [setSetupWizardOpen]);

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
      {setupWizardOpen && <SetupWizard />}
      {fileFinderOpen && canSearchRoot(rootPath) && (
        <FileFinder root={rootPath} onClose={() => setFileFinderOpen(false)} />
      )}
      <UpdateModal />
      <UpdateToast />
      <NotifyToast />
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
