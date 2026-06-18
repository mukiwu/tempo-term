import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TabBar } from "@/components/TabBar";
import { Sidebar } from "@/components/Sidebar";
import { Resizer } from "@/components/Resizer";
import { StatusBar } from "@/components/StatusBar";
import { SettingsModal } from "@/components/SettingsModal";
import { UpdateModal } from "@/components/UpdateModal";
import { TabsArea } from "@/components/TabsArea";
import { useUiStore } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFontStore } from "@/stores/fontStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { applyTheme, getTheme } from "@/themes/themes";

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 640;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function App() {
  const themeId = useSettingsStore((s) => s.themeId);
  const loadFontReport = useFontStore((s) => s.loadReport);
  const sidebarVisible = useUiStore((s) => s.sidebarVisible);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const [sidebarWidth, setSidebarWidth] = useState(260);

  useEffect(() => {
    applyTheme(getTheme(themeId), document.documentElement);
  }, [themeId]);

  // The window starts hidden (visible: false) to avoid a blank flash while the
  // webview boots; reveal it once the UI has painted its first frame.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        void getCurrentWindow().show().catch(() => {});
      } catch {
        // Not running inside a Tauri window (e.g. tests); nothing to reveal.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    void loadFontReport();
  }, [loadFontReport]);

  // Quietly check for a new release a few seconds after launch; the prompt only
  // appears if one actually exists, so a normal start stays uninterrupted.
  useEffect(() => {
    const timer = setTimeout(() => {
      void useUpdaterStore.getState().checkForUpdate({ silent: true });
    }, 5000);
    return () => clearTimeout(timer);
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
    </div>
  );
}

export default App;
