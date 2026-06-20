import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  Folder,
  GitBranch,
  GitPullRequest,
  Globe,
  LayoutGrid,
  Pencil,
  Plus,
  SquareTerminal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useTabsStore, type Tab, type TabKind } from "@/stores/tabsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProgressStore } from "@/modules/claude-progress/lib/progressStore";
import { deriveStatus } from "@/modules/claude-progress/lib/progressState";
import { deriveTabCwd } from "./lib/tabCwd";
import { selectCardTitle } from "./lib/cardTitle";
import { useWorktreeStore } from "./lib/worktreeStore";
import { useWorktreeInfos } from "./lib/useWorktreeInfos";
import { useTitlesStore } from "./lib/titlesStore";
import { useWorkspaceTitles } from "./lib/useWorkspaceTitles";
import { usePrStore } from "./lib/prStore";
import { useWorkspacePrs } from "./lib/useWorkspacePrs";
import type { WorktreeInfo } from "./lib/worktreeBridge";
import type { PrInfo } from "./lib/prBridge";

function tabIcon(kind: TabKind): LucideIcon {
  switch (kind) {
    case "terminal":
      return SquareTerminal;
    case "editor":
      return FileCode;
    case "note":
      return FileText;
    case "preview":
      return Globe;
    case "git-graph":
      return GitBranch;
    case "launcher":
      return LayoutGrid;
  }
}

type ClaudeStatus = ReturnType<typeof deriveStatus>;
type StatusFilter = "all" | ClaudeStatus;

const FILTERS: StatusFilter[] = ["all", "active", "idle", "thinking"];

type Sessions = ReturnType<typeof useProgressStore.getState>["sessions"];

/** The Claude status for a tab's representative cwd, or null when no session. */
function tabClaudeStatus(tab: Tab, sessions: Sessions): ClaudeStatus | null {
  const cwd = deriveTabCwd(tab);
  const progress = cwd ? sessions[cwd] : undefined;
  return progress ? deriveStatus(progress) : null;
}

const STATUS_STYLE: Record<ClaudeStatus, string> = {
  active: "bg-accent/15 text-accent",
  thinking: "bg-bg-elevated text-fg-muted",
  idle: "bg-warning/15 text-warning",
};

function StatusBadge({ status }: { status: ClaudeStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${STATUS_STYLE[status]}`}
    >
      {t(`workspace.status.${status}`)}
    </span>
  );
}

interface BranchFlags {
  showBranch: boolean;
  showCwd: boolean;
}

function BranchLine({
  branch,
  path,
  showBranch,
  showCwd,
}: { branch: string | null; path: string | null } & BranchFlags) {
  const shownBranch = showBranch ? branch : null;
  const shownPath = showCwd ? path : null;
  if (!shownBranch && !shownPath) {
    return null;
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
      <GitBranch size={11} className="shrink-0" />
      {shownBranch && <span className="shrink-0 text-fg-muted">{shownBranch}</span>}
      {shownPath && <span className="min-w-0 truncate">{shownPath}</span>}
    </span>
  );
}

/**
 * The branch/cwd block under a card title. A linked worktree shows two lines
 * (main repo, then worktree); a normal repo shows one. Before info loads, it
 * falls back to the plain cwd. Branch and cwd visibility follow settings.
 */
function BranchBlock({
  info,
  cwd,
  showBranch,
  showCwd,
}: { info: WorktreeInfo | undefined; cwd: string | null } & BranchFlags) {
  if (!showBranch && !showCwd) {
    return null;
  }
  if (!info) {
    return showCwd && cwd ? (
      <span className="block truncate text-[11px] text-fg-subtle">{cwd}</span>
    ) : null;
  }
  if (info.isWorktree) {
    return (
      <span className="block space-y-0.5">
        <BranchLine
          branch={info.mainBranch}
          path={info.mainPath}
          showBranch={showBranch}
          showCwd={showCwd}
        />
        <BranchLine
          branch={info.branch}
          path={info.cwd}
          showBranch={showBranch}
          showCwd={showCwd}
        />
      </span>
    );
  }
  return (
    <BranchLine branch={info.branch} path={info.cwd} showBranch={showBranch} showCwd={showCwd} />
  );
}

const PR_STATE_STYLE: Record<string, string> = {
  open: "text-success",
  draft: "text-fg-muted",
  merged: "text-accent",
  closed: "text-danger",
};

function PrBadge({ pr }: { pr: PrInfo }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] ${PR_STATE_STYLE[pr.state] ?? "text-fg-subtle"}`}
      title={pr.title ?? undefined}
    >
      <GitPullRequest size={11} className="shrink-0" />#{pr.number} {pr.state}
    </span>
  );
}

function TabCard({ tab }: { tab: Tab }) {
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const sessions = useProgressStore((s) => s.sessions);
  const infos = useWorktreeStore((s) => s.infos);
  const titles = useTitlesStore((s) => s.titles);
  const prs = usePrStore((s) => s.prs);
  const card = useSettingsStore((s) => s.workspaceCard);
  const active = tab.id === activeId;
  const cwd = deriveTabCwd(tab);
  const status = tabClaudeStatus(tab, sessions);
  const info = cwd ? infos[cwd] : undefined;
  const title = selectCardTitle(tab, titles);
  const pr = cwd ? prs[cwd] : undefined;
  const Icon = tabIcon(tab.kind);

  return (
    <button
      type="button"
      onClick={() => setActive(tab.id)}
      className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
        active
          ? "border-accent bg-accent/10 text-fg"
          : "border-border bg-bg-inset text-fg-muted hover:bg-bg-elevated"
      }`}
    >
      <Icon size={14} className="mt-0.5 shrink-0 text-fg-subtle" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">{title}</span>
          {card.status && status && <StatusBadge status={status} />}
        </span>
        <BranchBlock info={info} cwd={cwd} showBranch={card.branch} showCwd={card.cwd} />
        {card.pr && pr && (
          <span className="mt-0.5 block">
            <PrBadge pr={pr} />
          </span>
        )}
      </span>
    </button>
  );
}

function SpaceGroup({ id, name, filter }: { id: string; name: string; filter: StatusFilter }) {
  const { t } = useTranslation();
  const sessions = useProgressStore((s) => s.sessions);
  const setActiveSpace = useTabsStore((s) => s.setActiveSpace);
  const renameSpace = useTabsStore((s) => s.renameSpace);
  const deleteSpace = useTabsStore((s) => s.deleteSpace);
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const tabs = useTabsStore((s) => s.tabs)
    .filter((t) => t.spaceId === id)
    .filter((t) => filter === "all" || tabClaudeStatus(t, sessions) === filter);

  // Under an active filter a group with no matching cards adds only noise.
  if (filter !== "all" && tabs.length === 0) {
    return null;
  }

  function commitRename() {
    if (draft.trim()) {
      renameSpace(id, draft.trim());
    }
    setEditing(false);
  }

  return (
    <section className="space-y-1.5">
      <div className="group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-bg-elevated">
        {collapsed ? (
          <ChevronRight size={13} className="shrink-0 text-fg-subtle" />
        ) : (
          <ChevronDown size={13} className="shrink-0 text-fg-subtle" />
        )}
        <Folder size={14} className="shrink-0 text-fg-subtle" />

        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            className="min-w-0 flex-1 rounded border border-accent bg-bg px-1 text-xs text-fg outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setActiveSpace(id);
              setCollapsed((c) => !c);
            }}
            className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-fg"
          >
            {name}
          </button>
        )}

        {!editing && (
          <>
            <button
              type="button"
              aria-label={t("workspace.renameSpace")}
              title={t("workspace.renameSpace")}
              onClick={() => {
                setDraft(name);
                setEditing(true);
              }}
              className="shrink-0 rounded p-0.5 text-fg-subtle opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              aria-label={t("workspace.deleteSpace")}
              title={t("workspace.deleteSpace")}
              onClick={() => deleteSpace(id)}
              className="shrink-0 rounded p-0.5 text-fg-subtle opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
            >
              <Trash2 size={12} />
            </button>
            <span className="shrink-0 rounded-full bg-border px-1.5 py-0.5 text-[11px] leading-none text-fg-subtle">
              {tabs.length}
            </span>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="space-y-1.5 pl-2">
          {tabs.map((tab) => (
            <TabCard key={tab.id} tab={tab} />
          ))}
        </div>
      )}
    </section>
  );
}

export function WorkspacePanel() {
  const { t } = useTranslation();
  const spaces = useTabsStore((s) => s.spaces);
  const tabs = useTabsStore((s) => s.tabs);
  const newSpace = useTabsStore((s) => s.newSpace);
  const [filter, setFilter] = useState<StatusFilter>("all");

  const infos = useWorktreeStore((s) => s.infos);
  const showPr = useSettingsStore((s) => s.workspaceCard.pr);
  const prSource = useSettingsStore((s) => s.prSource);
  // Dedupe so multiple tabs in the same directory don't trigger redundant IPC
  // and network lookups for that directory.
  const cwds = Array.from(
    new Set(
      tabs.map((tab) => deriveTabCwd(tab)).filter((cwd): cwd is string => cwd !== null),
    ),
  );
  useWorktreeInfos(cwds);
  useWorkspaceTitles(cwds);

  // PR lookups need a branch, which comes from the worktree info fetched above.
  // Skip fetching entirely when the PR block is hidden.
  const prPairs = cwds
    .map((cwd) => ({ cwd, branch: infos[cwd]?.branch ?? "" }))
    .filter((pair) => pair.branch !== "");
  useWorkspacePrs(prPairs, showPr ? prSource : "off");

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
              filter === key ? "bg-bg-elevated text-fg" : "text-fg-subtle hover:text-fg"
            }`}
          >
            {t(`workspace.filter.${key}`)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {spaces.map((space) => (
          <SpaceGroup key={space.id} id={space.id} name={space.name} filter={filter} />
        ))}
      </div>
      <div className="shrink-0 border-t border-border p-2">
        <button
          type="button"
          onClick={() => newSpace()}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <Plus size={14} className="shrink-0" />
          {t("workspace.newSpace")}
        </button>
      </div>
    </div>
  );
}
