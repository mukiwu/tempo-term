import {
  Bot,
  EthernetPort,
  FolderTree,
  GitBranch,
  History,
  LayoutGrid,
  NotebookPen,
  Server,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { ExplorerView } from "@/modules/explorer/ExplorerView";
import { SourceControlView } from "@/modules/source-control/SourceControlView";
import { AIView } from "@/modules/ai/AIView";
import { NotesSidebar } from "@/modules/notes/NotesSidebar";
import { WorkspacePanel } from "@/modules/workspace/WorkspacePanel";
import { ConnectionsPanel } from "@/modules/ssh/ConnectionsPanel";
import { SessionsPanel } from "@/modules/sessions/SessionsPanel";
import { PortsPanelView } from "@/modules/ports/PortsPanelView";
import type { PanelId } from "@/stores/uiStore";

export interface PanelDef {
  icon: LucideIcon;
  labelKey: string;
  Component: ComponentType;
  /**
   * Keep the panel mounted (just hidden) when it is not the active panel,
   * instead of unmounting it. Only `workspaces` needs this: unmounting the
   * WorkspacePanel drops its cached worktree / title / PR fetches and re-fires
   * N IPC calls per cwd on every switch back — the main sidebar-switch jank.
   */
  mountAlways?: boolean;
  /** Badge the strip icon with the aggregate agent session status (working /
   *  waiting / idle). Set on the panels that surface agent activity. */
  showSessionStatus?: boolean;
}

/**
 * Single source of truth for every dockable panel: its icon, i18n label, the
 * component to render, and its mount strategy. Replaces the old `SIDEBAR_TABS`
 * map. Keyed by `PanelId` so both dock columns render from the same registry.
 */
export const PANEL_REGISTRY: Record<PanelId, PanelDef> = {
  workspaces: {
    icon: LayoutGrid,
    labelKey: "nav.workspaces",
    Component: WorkspacePanel,
    mountAlways: true,
    showSessionStatus: true,
  },
  explorer: { icon: FolderTree, labelKey: "nav.explorer", Component: ExplorerView },
  sourceControl: { icon: GitBranch, labelKey: "nav.git", Component: SourceControlView },
  notes: { icon: NotebookPen, labelKey: "nav.notes", Component: NotesSidebar },
  ai: { icon: Bot, labelKey: "nav.ai", Component: AIView },
  connections: { icon: Server, labelKey: "nav.connections", Component: ConnectionsPanel },
  sessions: {
    icon: History,
    labelKey: "nav.sessions",
    Component: SessionsPanel,
    showSessionStatus: true,
  },
  ports: { icon: EthernetPort, labelKey: "nav.ports", Component: PortsPanelView },
};
