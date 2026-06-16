import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, TerminalSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WorkspaceTabBar } from "@/components/WorkspaceTabBar";
import { ActivityRail } from "@/components/ActivityRail";
import { Sidebar } from "@/components/Sidebar";
import { Resizer } from "@/components/Resizer";
import { StatusBar } from "@/components/StatusBar";
import { SettingsModal } from "@/components/SettingsModal";
import { EditorView } from "@/modules/editor/EditorView";
import { TerminalWorkspace } from "@/modules/terminal/TerminalWorkspace";
import { useUiStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFontStore } from "@/stores/fontStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceTabsStore } from "@/stores/workspaceTabsStore";
import { useTerminalTabsStore } from "@/modules/terminal/store/terminalTabsStore";
import { applyTheme, getTheme } from "@/themes/themes";

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 640;
const MIN_TERMINAL = 80;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function App() {
  const { t } = useTranslation();
  const themeId = useSettingsStore((s) => s.themeId);
  const loadFontReport = useFontStore((s) => s.loadReport);

  const sidebarVisible = useUiStore((s) => s.sidebarVisible);
  const terminalOpen = useUiStore((s) => s.terminalOpen);
  const toggleTerminal = useUiStore((s) => s.toggleTerminal);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const activeTabId = useWorkspaceTabsStore((s) => s.activeTabId);

  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [terminalHeight, setTerminalHeight] = useState(260);

  useEffect(() => {
    applyTheme(getTheme(themeId), document.documentElement);
  }, [themeId]);

  useEffect(() => {
    void loadFontReport();
  }, [loadFontReport]);

  // Switching the active workspace tab repoints the explorer and git at its folder.
  useEffect(() => {
    const root = useWorkspaceTabsStore.getState().activeRootPath();
    if (root) {
      useWorkspaceStore.getState().setRoot(root);
    }
  }, [activeTabId]);

  // Global keyboard shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "t") {
        e.preventDefault();
        useTerminalTabsStore.getState().addTab();
        useUiStore.getState().setTerminalOpen(true);
      } else if (key === "p") {
        e.preventDefault();
        useUiStore.getState().openFileFinder();
      } else if (key === "b") {
        e.preventDefault();
        useUiStore.getState().toggleSidebar();
      } else if (key === "j") {
        e.preventDefault();
        useUiStore.getState().toggleTerminal();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg">
      <WorkspaceTabBar />

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

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <EditorView />
          </div>

          {/* Terminal dock */}
          <div className="flex shrink-0 flex-col border-t border-border">
            <button
              type="button"
              onClick={toggleTerminal}
              title={t("workspace.toggleTerminal")}
              className="flex h-8 shrink-0 items-center justify-between bg-bg-inset px-3 transition-colors hover:bg-bg-elevated"
            >
              <span className="flex items-center gap-1.5 font-mono text-[12px] font-bold uppercase tracking-wider text-fg-subtle">
                <TerminalSquare size={14} />
                {t("workspace.terminal")}
              </span>
              {terminalOpen ? (
                <ChevronDown size={14} className="text-fg-subtle" />
              ) : (
                <ChevronUp size={14} className="text-fg-subtle" />
              )}
            </button>
            {terminalOpen && (
              <>
                <Resizer
                  orientation="horizontal"
                  onResize={(d) =>
                    setTerminalHeight((h) =>
                      clamp(h - d, MIN_TERMINAL, window.innerHeight - 200),
                    )
                  }
                />
                <div style={{ height: terminalHeight }} className="overflow-hidden">
                  <TerminalWorkspace />
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      <StatusBar />
      {settingsOpen && <SettingsModal />}
    </div>
  );
}

export default App;
