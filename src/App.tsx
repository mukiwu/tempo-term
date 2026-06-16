import { useEffect } from "react";
import { ActivityBar } from "@/components/ActivityBar";
import { TitleBar } from "@/components/TitleBar";
import { StatusBar } from "@/components/StatusBar";
import { SettingsView } from "@/modules/settings/SettingsView";
import { TerminalWorkspace } from "@/modules/terminal/TerminalWorkspace";
import { ExplorerView } from "@/modules/explorer/ExplorerView";
import { EditorView } from "@/modules/editor/EditorView";
import { SourceControlView } from "@/modules/source-control/SourceControlView";
import { AIView } from "@/modules/ai/AIView";
import { useUiStore, type ViewId } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFontStore } from "@/stores/fontStore";

function ActiveView({ view }: { view: ViewId }) {
  switch (view) {
    case "settings":
      return <SettingsView />;
    case "explorer":
      return <ExplorerView />;
    case "editor":
      return <EditorView />;
    case "sourceControl":
      return <SourceControlView />;
    case "ai":
      return <AIView />;
    case "terminal":
    default:
      return <TerminalWorkspace />;
  }
}

function App() {
  const activeView = useUiStore((s) => s.activeView);
  const theme = useSettingsStore((s) => s.theme);
  const loadFontReport = useFontStore((s) => s.loadReport);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  // Detect installed fonts once so the terminal can pick a Traditional Chinese
  // fallback and the settings picker is populated.
  useEffect(() => {
    void loadFontReport();
  }, [loadFontReport]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[--color-bg] text-[--color-fg]">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <main className="min-w-0 flex-1 overflow-hidden">
          <ActiveView view={activeView} />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
