import { useEffect, useState } from "react";
import { TabBar } from "@/components/TabBar";
import { Sidebar } from "@/components/Sidebar";
import { Resizer } from "@/components/Resizer";
import { StatusBar } from "@/components/StatusBar";
import { SettingsModal } from "@/components/SettingsModal";
import { UpdateModal } from "@/components/UpdateModal";
import { UpdateToast } from "@/components/UpdateToast";
import { TabsArea } from "@/components/TabsArea";
import { useUiStore } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { pruneTerminalHistory } from "@/modules/terminal/lib/terminalHistory";
import { leafIds } from "@/modules/terminal/lib/terminalLayout";
import { applyTheme, getTheme } from "@/themes/themes";
import { listen } from "@tauri-apps/api/event";
import { useProgressStore } from "@/modules/claude-progress/lib/progressStore";
import { useWatchSessions } from "@/modules/claude-progress/lib/useWatchSessions";
import { installStatusHook, installCodexStatusHook } from "@/modules/claude-progress/lib/statusHookBridge";
import { useWatchNotes } from "@/modules/notes/lib/useWatchNotes";
import { registerSecondaryWindowCleanup } from "@/lib/windowLifecycle";
import { SshPromptDialog } from "@/modules/ssh/SshPromptDialog";
import { useForwardStatusListener } from "@/modules/ssh/lib/useForwardStatus";
import { sftpSessionStore } from "@/modules/ssh/lib/sftpSessionStore";

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 640;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function App() {
  const themeId = useSettingsStore((s) => s.themeId);
  const sidebarVisible = useUiStore((s) => s.sidebarVisible);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const [sidebarWidth, setSidebarWidth] = useState(260);

  useWatchSessions();
  useWatchNotes();
  useForwardStatusListener();

  useEffect(() => {
    applyTheme(getTheme(themeId), document.documentElement);
  }, [themeId]);

  // The font report (enumerating every installed family) is loaded lazily by
  // the Fonts settings section when it opens, not at startup — the terminal's
  // default font chain already covers CJK, so a cold launch does no font work.

  // Drop saved terminal scrollback for panes that no longer exist (orphans
  // left by closed tabs/panes), keeping only the panes still in the layout.
  useEffect(() => {
    const keep = useTabsStore.getState().tabs.flatMap((t) => leafIds(t.paneTree));
    void pruneTerminalHistory(keep).catch(() => {});
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
      if (!(e.metaKey || e.ctrlKey)) {
        return;
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
        useTabsStore.getState().closePaneOrTab();
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
    </div>
  );
}

export default App;
