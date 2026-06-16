import { ExplorerView } from "@/modules/explorer/ExplorerView";
import { SourceControlView } from "@/modules/source-control/SourceControlView";
import { AIView } from "@/modules/ai/AIView";
import { NotesSidebar } from "@/modules/notes/NotesSidebar";
import { useUiStore } from "@/stores/uiStore";

export function Sidebar() {
  const sidebarView = useUiStore((s) => s.sidebarView);
  return (
    <div className="h-full w-full overflow-hidden border-r border-border bg-bg-inset">
      {sidebarView === "explorer" && <ExplorerView />}
      {sidebarView === "sourceControl" && <SourceControlView />}
      {sidebarView === "ai" && <AIView />}
      {sidebarView === "notes" && <NotesSidebar />}
    </div>
  );
}
