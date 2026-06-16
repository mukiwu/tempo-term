import { useTranslation } from "react-i18next";
import { FolderTree, GitBranch, NotebookPen, type LucideIcon } from "lucide-react";
import { ExplorerView } from "@/modules/explorer/ExplorerView";
import { SourceControlView } from "@/modules/source-control/SourceControlView";
import { AIView } from "@/modules/ai/AIView";
import { NotesSidebar } from "@/modules/notes/NotesSidebar";
import { useUiStore, type SidebarView } from "@/stores/uiStore";

interface SidebarTab {
  id: SidebarView;
  icon: LucideIcon;
  labelKey: string;
}

const SIDEBAR_TABS: SidebarTab[] = [
  { id: "explorer", icon: FolderTree, labelKey: "nav.explorer" },
  { id: "sourceControl", icon: GitBranch, labelKey: "nav.git" },
  { id: "notes", icon: NotebookPen, labelKey: "nav.notes" },
];

export function Sidebar() {
  const { t } = useTranslation();
  const sidebarView = useUiStore((s) => s.sidebarView);
  const selectSidebar = useUiStore((s) => s.selectSidebar);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-bg-inset">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-1.5">
        {SIDEBAR_TABS.map(({ id, icon: Icon, labelKey }) => {
          const active = sidebarView === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => selectSidebar(id)}
              className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${
                active ? "bg-bg-elevated text-fg" : "text-fg-subtle hover:text-fg"
              }`}
            >
              <Icon size={14} />
              <span>{t(labelKey)}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {sidebarView === "explorer" && <ExplorerView />}
        {sidebarView === "sourceControl" && <SourceControlView />}
        {sidebarView === "notes" && <NotesSidebar />}
        {sidebarView === "ai" && <AIView />}
      </div>
    </div>
  );
}
