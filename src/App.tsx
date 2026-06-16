import { useEffect, useState } from "react";
import { TabBar } from "@/components/TabBar";
import { ActivityRail } from "@/components/ActivityRail";
import { Sidebar } from "@/components/Sidebar";
import { Resizer } from "@/components/Resizer";
import { StatusBar } from "@/components/StatusBar";
import { SettingsModal } from "@/components/SettingsModal";
import { TabsArea } from "@/components/TabsArea";
import { useUiStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFontStore } from "@/stores/fontStore";
import { useTabsStore } from "@/stores/tabsStore";
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

  useEffect(() => {
    void loadFontReport();
  }, [loadFontReport]);

  // Global keyboard shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "t") {
        e.preventDefault();
        useTabsStore.getState().newTerminalTab();
      } else if (key === "p") {
        e.preventDefault();
        useUiStore.getState().openFileFinder();
      } else if (key === "b") {
        e.preventDefault();
        useUiStore.getState().toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg">
      <TabBar />

      <div className="flex min-h-0 flex-1">
        <ActivityRail />

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
    </div>
  );
}

export default App;
