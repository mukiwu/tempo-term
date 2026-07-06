import { useTranslation } from "react-i18next";
import { Bot, FolderTree, GitBranch, History, LayoutGrid, NotebookPen, Server, type LucideIcon } from "lucide-react";
import { ExplorerView } from "@/modules/explorer/ExplorerView";
import { SourceControlView } from "@/modules/source-control/SourceControlView";
import { AIView } from "@/modules/ai/AIView";
import { NotesSidebar } from "@/modules/notes/NotesSidebar";
import { WorkspacePanel } from "@/modules/workspace/WorkspacePanel";
import { ConnectionsPanel } from "@/modules/ssh/ConnectionsPanel";
import { SessionsPanel } from "@/modules/sessions/SessionsPanel";
import { Tooltip } from "@/components/Tooltip";
import { useUiStore, type SidebarView } from "@/stores/uiStore";
import { probeStart } from "@/lib/perfProbe";

interface SidebarTab {
  id: SidebarView;
  icon: LucideIcon;
  labelKey: string;
}

const SIDEBAR_TABS: SidebarTab[] = [
  { id: "workspaces", icon: LayoutGrid, labelKey: "nav.workspaces" },
  { id: "explorer", icon: FolderTree, labelKey: "nav.explorer" },
  { id: "sourceControl", icon: GitBranch, labelKey: "nav.git" },
  { id: "notes", icon: NotebookPen, labelKey: "nav.notes" },
  { id: "ai", icon: Bot, labelKey: "nav.ai" },
  { id: "connections", icon: Server, labelKey: "nav.connections" },
  { id: "sessions", icon: History, labelKey: "nav.sessions" },
];

/**
 * The sidebar panels in their displayed left-to-right order, so ⌥1…⌥7 can map a
 * number to the matching panel. Kept beside SIDEBAR_TABS so the order never
 * drifts from what the icon bar renders.
 */
export const SIDEBAR_VIEW_ORDER: SidebarView[] = SIDEBAR_TABS.map((tab) => tab.id);

export function Sidebar() {
  const { t } = useTranslation();
  const sidebarView = useUiStore((s) => s.sidebarView);
  const selectSidebar = useUiStore((s) => s.selectSidebar);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-bg-inset">
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-1.5">
        {SIDEBAR_TABS.map(({ id, icon: Icon, labelKey }) => {
          const active = sidebarView === id;
          return (
            <Tooltip key={id} label={t(labelKey)} side="bottom">
              <button
                type="button"
                aria-label={t(labelKey)}
                aria-pressed={active}
                onClick={() => {
                  if (id === "workspaces") probeStart();
                  selectSidebar(id);
                }}
                className={`flex h-7 w-8 items-center justify-center border-b-2 transition-colors ${
                  active
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-subtle hover:border-border-strong hover:text-fg"
                }`}
              >
                <Icon size={15} />
              </button>
            </Tooltip>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {/*
         * WorkspacePanel stays mounted and is just hidden when another sidebar
         * view is active. Unmounting it drops the cached worktree / title / PR
         * fetches and re-fires N IPC calls per cwd on every switch back, which
         * is the main contributor to the multi-second sidebar-switch jank. The
         * other panels still mount conditionally because their state cleanup
         * on unmount is cheap and their cards do not chain IPC storms.
         */}
        <div className="h-full w-full" hidden={sidebarView !== "workspaces"}>
          <WorkspacePanel />
        </div>
        {sidebarView === "explorer" && <ExplorerView />}
        {sidebarView === "sourceControl" && <SourceControlView />}
        {sidebarView === "notes" && <NotesSidebar />}
        {sidebarView === "ai" && <AIView />}
        {sidebarView === "connections" && <ConnectionsPanel />}
        {sidebarView === "sessions" && <SessionsPanel />}
      </div>
    </div>
  );
}
