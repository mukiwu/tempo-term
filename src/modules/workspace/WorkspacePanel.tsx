import { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  Folder,
  GitBranch,
  GitCompare,
  GitPullRequest,
  Globe,
  History,
  LayoutGrid,
  Pencil,
  Plus,
  SquareTerminal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useTabsStore, type Tab, type TabKind } from "@/stores/tabsStore";
import { Tooltip } from "@/components/Tooltip";
import { ContextMenu } from "@/components/ContextMenu";
import { tabContextMenuItems } from "@/components/tabContextMenuItems";
import { useTabCloseRequest } from "@/components/useTabCloseRequest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import type { SessionStatus } from "@/modules/claude-progress/lib/sessionStatus";
import { tabSessionStatus } from "./lib/tabSessionStatus";
import { deriveTabCwd } from "./lib/tabCwd";
import { selectCardTitle } from "./lib/cardTitle";
import { collectTabSessions, type TabSession } from "./lib/tabSessions";
import { useWorktreeStore } from "./lib/worktreeStore";
import { useWorktreeInfos } from "./lib/useWorktreeInfos";
import { useTitlesStore } from "./lib/titlesStore";
import { useWorkspaceTitles } from "./lib/useWorkspaceTitles";
import { usePrStore } from "./lib/prStore";
import { useWorkspacePrs } from "./lib/useWorkspacePrs";
import type { WorktreeInfo } from "./lib/worktreeBridge";
import type { PrInfo } from "./lib/prBridge";
import { progressKey } from "@/modules/claude-progress/lib/progressStore";
import { agentLabel } from "./lib/agentLabel";
import { probeCardRender } from "@/lib/perfProbe";

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
    case "diff":
      return GitCompare;
    case "sessions":
      return History;
    case "launcher":
      return LayoutGrid;
  }
}

type StatusFilter = "all" | SessionStatus;

const FILTERS: StatusFilter[] = ["all", "active", "idle", "thinking", "waiting-approval"];

const STATUS_STYLE: Record<SessionStatus, string> = {
  active: "bg-accent/15 text-accent",
  thinking: "bg-bg-elevated text-fg-muted",
  "waiting-approval": "bg-danger/15 text-danger",
  idle: "bg-warning/15 text-warning",
};

function StatusBadge({ status }: { status: SessionStatus }) {
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
  // Branch name and path each get their own line and wrap in full (no
  // truncation) so a long repo or path is always readable. The path is indented
  // to sit under the branch text, so it stays visually paired with its repo when
  // a card lists more than one (e.g. a worktree's main repo plus the worktree).
  return (
    <span className="block text-[11px] leading-snug text-fg-subtle">
      {shownBranch && (
        <span className="flex items-start gap-1 text-fg-muted">
          <GitBranch size={11} className="mt-[3px] shrink-0" />
          <span className="min-w-0 break-all">{shownBranch}</span>
        </span>
      )}
      {shownPath && (
        <span className={`block break-all ${shownBranch ? "pl-[15px]" : ""}`}>{shownPath}</span>
      )}
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
      <span className="block break-all text-[11px] leading-snug text-fg-subtle">{cwd}</span>
    ) : null;
  }
  if (info.isWorktree) {
    // Extra space between the two repo groups so each branch stays visually
    // paired with its own path.
    return (
      <span className="block space-y-1.5">
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
    <Tooltip label={pr.title} className="shrink-0">
      <span
        className={`inline-flex items-center gap-1 text-[11px] ${PR_STATE_STYLE[pr.state] ?? "text-fg-subtle"}`}
      >
        <GitPullRequest size={11} className="shrink-0" />#{pr.number} {pr.state}
      </span>
    </Tooltip>
  );
}

/** The last path segment of a cwd, used when a session has no transcript title yet. */
function basename(path: string): string {
  // Split on both separators so Windows paths (C:\...) basename correctly too.
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** A session's display title: its transcript title, else its directory name. */
function sessionTitle(session: TabSession, titles: Record<string, string>): string {
  if (session.agent && session.cwd) {
    const auto = titles[progressKey(session.cwd, session.agent)];
    if (auto) {
      return auto;
    }
  }
  return session.cwd ? basename(session.cwd) : "";
}

/**
 * One session line inside a card that runs more than one agent: its status, the
 * agent label, and its own title. The status badge follows the card setting.
 */
function SessionRow({
  session,
  titles,
  showStatus,
}: {
  session: TabSession;
  titles: Record<string, string>;
  showStatus: boolean;
}) {
  const label = agentLabel(session.agent);
  return (
    <span className="flex items-center gap-1.5">
      {showStatus && <StatusBadge status={session.status} />}
      {label && <span className="shrink-0 text-[11px] text-fg-subtle">{label}</span>}
      <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
        {sessionTitle(session, titles)}
      </span>
    </span>
  );
}

function TabCard({ tab, index }: { tab: Tab; index: number }) {
  probeCardRender();
  const { t } = useTranslation();
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const setTabTitle = useTabsStore((s) => s.setTabTitle);
  const { requestClose, confirmCloseDialog } = useTabCloseRequest(tab);
  const statuses = useSessionStatusStore((s) => s.statuses);
  const leafAgents = useSessionStatusStore((s) => s.agents);
  const infos = useWorktreeStore((s) => s.infos);
  const titles = useTitlesStore((s) => s.titles);
  const prs = usePrStore((s) => s.prs);
  const card = useSettingsStore((s) => s.workspaceCard);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const active = tab.id === activeId;
  const cwd = deriveTabCwd(tab);
  // Each pane running an agent is its own session. With two or more, the header
  // becomes the tab's identity and every session gets its own line below.
  const sessions = collectTabSessions(tab, statuses, leafAgents);
  const multi = sessions.length >= 2;
  const primary = sessions[0];
  const status = tabSessionStatus(tab, statuses);
  const info = cwd ? infos[cwd] : undefined;
  const autoTitle =
    !multi && primary?.cwd && primary?.agent
      ? titles[progressKey(primary.cwd, primary.agent)]
      : undefined;
  const title = selectCardTitle(tab, autoTitle);
  const pr = cwd ? prs[cwd] : undefined;
  const Icon = tabIcon(tab.kind);
  const label = agentLabel(primary?.agent);

  function startRename() {
    setDraft(title);
    setEditing(true);
  }

  function commitRename() {
    const next = draft.trim();
    if (next) {
      setTabTitle(tab.id, next);
    }
    setEditing(false);
  }

  // Focus + select the inline rename input once it mounts so the user can type
  // a new name immediately, matching the main TabBar's rename UX.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  return (
    <button
      type="button"
      onClick={() => setActive(tab.id)}
      onContextMenu={(event) => {
        // Right-clicks on the rename input skip the card menu and bubble to
        // the window-level InputContextMenu, like every other text field.
        if (event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      className={`flex w-full items-stretch gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
        active
          ? "border-accent bg-accent/10 text-fg"
          : "border-border bg-bg-inset text-fg-muted hover:bg-bg-elevated"
      }`}
    >
      <span className="flex shrink-0 flex-col items-center justify-start gap-1">
        <Icon size={14} className="text-fg-subtle" />
        <span className="text-[10px] font-medium leading-none text-fg-subtle">{index}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitRename}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitRename();
                if (event.key === "Escape") setEditing(false);
              }}
              className="min-w-0 flex-1 rounded border border-accent bg-bg px-1 text-xs text-fg outline-none"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">{title}</span>
          )}
          {!multi && card.status && status && <StatusBadge status={status} />}
          {!multi && card.status && status && label && (
            <span className="shrink-0 text-[11px] text-fg-subtle">{label}</span>
          )}
        </span>
        {multi && (
          <span className="mt-1 block space-y-0.5">
            {sessions.map((session) => (
              <SessionRow
                key={session.leafId}
                session={session}
                titles={titles}
                showStatus={card.status}
              />
            ))}
          </span>
        )}
        <BranchBlock info={info} cwd={cwd} showBranch={card.branch} showCwd={card.cwd} />
        {card.pr && pr && (
          <span className="mt-0.5 block">
            <PrBadge pr={pr} />
          </span>
        )}
      </span>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={tabContextMenuItems(t, {
            onRename: startRename,
            onClose: requestClose,
          })}
        />
      )}
      {confirmCloseDialog}
    </button>
  );
}

function SpaceGroup({ id, name, filter }: { id: string; name: string; filter: StatusFilter }) {
  const { t } = useTranslation();
  const statuses = useSessionStatusStore((s) => s.statuses);
  const setActiveSpace = useTabsStore((s) => s.setActiveSpace);
  const renameSpace = useTabsStore((s) => s.renameSpace);
  const deleteSpace = useTabsStore((s) => s.deleteSpace);
  const openLauncherTab = useTabsStore((s) => s.openLauncherTab);
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Select the raw (store-stable) tab list, then memoize the per-space slice on
  // its reference so frequent SpaceGroup re-renders (typing in the rename field,
  // status updates) don't rebuild it. zustand keeps the same array reference
  // until tabs actually change.
  const allTabsRaw = useTabsStore((s) => s.tabs);
  const allTabs = useMemo(() => allTabsRaw.filter((t) => t.spaceId === id), [allTabsRaw, id]);
  // Number cards by their position in the full space list (not the filtered one)
  // so the badge keeps matching ⌘1-9, which also indexes the unfiltered tabs.
  const tabs = allTabs.filter((t) => filter === "all" || tabSessionStatus(t, statuses) === filter);
  // 1-based position in the unfiltered space list, so the badge keeps matching
  // ⌘1-9. O(1) lookup per card (vs an O(n) indexOf), memoized on the slice so a
  // rename keystroke or status update doesn't rebuild the map.
  const tabNumberById = useMemo(() => new Map(allTabs.map((tab, i) => [tab.id, i + 1])), [allTabs]);

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
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip label={t("workspace.renameSpace")} className="shrink-0">
              <button
                type="button"
                aria-label={t("workspace.renameSpace")}
                onClick={() => {
                  setDraft(name);
                  setEditing(true);
                }}
                className="shrink-0 rounded p-0.5 text-fg-subtle transition-colors hover:text-fg"
              >
                <Pencil size={12} />
              </button>
            </Tooltip>
            <Tooltip label={t("workspace.deleteSpace")} className="shrink-0">
              <button
                type="button"
                aria-label={t("workspace.deleteSpace")}
                onClick={() => deleteSpace(id)}
                className="shrink-0 rounded p-0.5 text-fg-subtle transition-colors hover:text-danger"
              >
                <Trash2 size={12} />
              </button>
            </Tooltip>
            <Tooltip label={t("workspace.addTab")} className="shrink-0">
              <button
                type="button"
                aria-label={t("workspace.addTab")}
                onClick={() => {
                  setActiveSpace(id);
                  openLauncherTab();
                  // Expand the group so the freshly added card is visible.
                  setCollapsed(false);
                }}
                className="shrink-0 rounded p-0.5 text-fg-subtle transition-colors hover:text-fg"
              >
                <Plus size={12} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="space-y-1.5 pl-2">
          {tabs.map((tab) => (
            <TabCard key={tab.id} tab={tab} index={tabNumberById.get(tab.id) ?? 0} />
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
  const statuses = useSessionStatusStore((s) => s.statuses);
  const leafAgents = useSessionStatusStore((s) => s.agents);
  // Dedupe so multiple tabs in the same directory don't trigger redundant IPC
  // and network lookups for that directory.
  const cwds = useMemo(
    () =>
      Array.from(
        new Set(
          tabs.map((tab) => deriveTabCwd(tab)).filter((cwd): cwd is string => cwd !== null),
        ),
      ),
    [tabs],
  );
  useWorktreeInfos(cwds);
  // Titles are per session (cwd + agent), so a directory running both Claude and
  // Codex gets each one's own title fetched.
  const titleTargets = useMemo(
    () =>
      tabs.flatMap((tab) =>
        collectTabSessions(tab, statuses, leafAgents).flatMap((session) =>
          session.cwd && session.agent ? [{ cwd: session.cwd, agent: session.agent }] : [],
        ),
      ),
    [tabs, statuses, leafAgents],
  );
  useWorkspaceTitles(titleTargets);

  // PR lookups need a branch, which comes from the worktree info fetched above.
  // Skip fetching entirely when the PR block is hidden.
  const prPairs = useMemo(
    () =>
      cwds
        .map((cwd) => ({ cwd, branch: infos[cwd]?.branch ?? "" }))
        .filter((pair) => pair.branch !== ""),
    [cwds, infos],
  );
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
