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
  Image,
  LayoutGrid,
  Pencil,
  Plus,
  SquareTerminal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useTabsStore, type Tab, type TabKind } from "@/stores/tabsStore";
import { AgentIcon } from "@/components/AgentIcon";
import { Tooltip } from "@/components/Tooltip";
import { useIsTruncated } from "@/components/useIsTruncated";
import { ContextMenu } from "@/components/ContextMenu";
import { tabContextMenuItems } from "@/components/tabContextMenuItems";
import { useTabCloseRequest } from "@/components/useTabCloseRequest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import type { SessionStatus } from "@/modules/claude-progress/lib/sessionStatus";
import type { AgentKind } from "@/modules/claude-progress/lib/codexNormalize";
import { tabSessionStatus } from "./lib/tabSessionStatus";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import { deriveTabCwd } from "./lib/tabCwd";
import { selectCardTitle } from "./lib/cardTitle";
import { collectTabSessions, type TabSession } from "./lib/tabSessions";
import { useWorktreeStore } from "./lib/worktreeStore";
import { useWorktreeInfos } from "./lib/useWorktreeInfos";
import { titleKey, useTitlesStore } from "./lib/titlesStore";
import { useWorkspaceTitles } from "./lib/useWorkspaceTitles";
import { usePrStore } from "./lib/prStore";
import { useWorkspacePrs } from "./lib/useWorkspacePrs";
import type { WorktreeInfo } from "./lib/worktreeBridge";
import type { PrInfo } from "./lib/prBridge";
import { agentLabel } from "./lib/agentLabel";
import { abbreviateHome } from "./lib/abbreviatePath";
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
    case "media":
      return Image;
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
  agent,
  showBranch,
  showCwd,
}: { branch: string | null; path: string | null; agent?: AgentKind } & BranchFlags) {
  const shownBranch = showBranch ? branch : null;
  const shownPath = showCwd && path ? abbreviateHome(path) : null;
  if (!shownBranch && !shownPath) {
    return null;
  }
  // Branch name and path each get their own line and wrap in full (no
  // truncation) so a long repo or path is always readable. The path is indented
  // to sit under the branch text, so it stays visually paired with its repo when
  // a card lists more than one (e.g. a worktree's main repo plus the worktree).
  // A detected CLI's logomark takes over the indent slot (icon 11px + gap 4px
  // = the same 15px), marking which agent runs in that directory.
  return (
    <span className="block text-[11px] leading-snug text-fg-subtle">
      {shownBranch && (
        <span className="flex items-start gap-1 text-fg-muted">
          <GitBranch size={11} className="mt-[3px] shrink-0" />
          <span className="min-w-0 break-all">{shownBranch}</span>
        </span>
      )}
      {shownPath &&
        (agent ? (
          <span className="flex items-start gap-1">
            <AgentIcon agent={agent} size={11} className="mt-[3px] shrink-0" />
            <span className="min-w-0 break-all">{shownPath}</span>
          </span>
        ) : (
          <span className={`block break-all ${shownBranch ? "pl-[15px]" : ""}`}>{shownPath}</span>
        ))}
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
  agent,
  showBranch,
  showCwd,
}: { info: WorktreeInfo | undefined; cwd: string | null; agent?: AgentKind } & BranchFlags) {
  if (!showBranch && !showCwd) {
    return null;
  }
  if (!info) {
    return showCwd && cwd ? (
      <BranchLine branch={null} path={cwd} agent={agent} showBranch={showBranch} showCwd={showCwd} />
    ) : null;
  }
  if (info.isWorktree) {
    // Extra space between the two repo groups so each branch stays visually
    // paired with its own path. The agent runs in the worktree, so only that
    // line carries the CLI icon.
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
          agent={agent}
          showBranch={showBranch}
          showCwd={showCwd}
        />
      </span>
    );
  }
  return (
    <BranchLine
      branch={info.branch}
      path={info.cwd}
      agent={agent}
      showBranch={showBranch}
      showCwd={showCwd}
    />
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
    const auto = titles[
      titleKey({ cwd: session.cwd, agent: session.agent, sessionId: session.sessionId })
    ];
    if (auto) {
      return auto;
    }
  }
  return session.cwd ? basename(session.cwd) : "";
}

/**
 * One pane's session inside a split card, a five-line block: the pane's own
 * card title (its folder name, accented while the pane is the tab's focused
 * one), then agent logomark + session title with the status badge pushed
 * right, then that pane's own branch, directory, and PR.
 */
function SessionBlock({
  session,
  titles,
  showStatus,
  active,
  divider,
  info,
  pr,
  showBranch,
  showCwd,
}: {
  session: TabSession;
  titles: Record<string, string>;
  showStatus: boolean;
  active: boolean;
  /** Draw a separator above this block (every block but the card's first). */
  divider: boolean;
  info: WorktreeInfo | undefined;
  pr: PrInfo | undefined;
} & BranchFlags) {
  const blockTitle = session.cwd ? basename(session.cwd) : sessionTitle(session, titles);
  const title = sessionTitle(session, titles);
  const [blockTitleRef, blockTitleTruncated] = useIsTruncated(blockTitle);
  const [titleRef, truncated] = useIsTruncated(title);
  return (
    <span className={`block ${divider ? "border-t border-border pt-1.5" : ""}`}>
      {/* flex, not a bare line box: line-height slack above the inline-flex
          tooltip wrapper would push the first block below the tab icon. */}
      <span className="flex">
        <Tooltip label={blockTitleTruncated && blockTitle} className="w-full">
          <span
            ref={blockTitleRef}
            className={`min-w-0 flex-1 truncate text-xs font-medium ${
              active ? "text-accent" : "text-fg"
            }`}
          >
            {blockTitle}
          </span>
        </Tooltip>
      </span>
      <span className="mt-0.5 flex items-center gap-1.5">
        {session.agent && (
          <Tooltip label={agentLabel(session.agent)} className="shrink-0">
            <AgentIcon agent={session.agent} size={12} className="shrink-0 text-fg-subtle" />
          </Tooltip>
        )}
        <Tooltip label={truncated && title} className="min-w-0 flex-1">
          <span ref={titleRef} className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
            {title}
          </span>
        </Tooltip>
        {showStatus && <StatusBadge status={session.status} />}
      </span>
      <BranchBlock info={info} cwd={session.cwd} showBranch={showBranch} showCwd={showCwd} />
      {pr && (
        <span className="mt-0.5 flex">
          <PrBadge pr={pr} />
        </span>
      )}
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
  const sessionIds = useSessionStatusStore((s) => s.sessionIds);
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
  const sessions = collectTabSessions(tab, statuses, leafAgents, sessionIds);
  const multi = sessions.length >= 2;
  const primary = sessions[0];
  const status = tabSessionStatus(tab, statuses);
  const info = cwd ? infos[cwd] : undefined;
  const autoTitle =
    !multi && primary?.cwd && primary?.agent
      ? titles[
          titleKey({
            cwd: primary.cwd,
            agent: primary.agent,
            sessionId: primary.sessionId,
          })
        ]
      : undefined;
  const title = selectCardTitle(tab, autoTitle);
  const pr = cwd ? prs[cwd] : undefined;
  const Icon = tabIcon(tab.kind);
  // The CLI icon on the directory line marks a single-session card's agent;
  // a multi-session card labels each session row with its own icon instead.
  const cardAgent = multi ? undefined : primary?.agent;
  // The rename input replaces the title span while editing, which detaches the
  // ref and turns the flag (and so the card tooltip) off on its own.
  const [titleRef, titleTruncated] = useIsTruncated(title);

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
    // The whole card reveals the full title on hover, but only while the title
    // is actually truncated. Tooltips inside the card (PR badge, session rows)
    // suppress this one while hovered, so they never stack.
    <Tooltip label={titleTruncated && title} className="w-full">
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
          {/* A split card has no shared title row — each pane block carries its
              own; the row still appears there while renaming the tab. */}
          {(editing || !multi) && (
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
                <span
                  ref={titleRef}
                  className="min-w-0 flex-1 truncate text-xs font-medium text-fg"
                >
                  {title}
                </span>
              )}
              {!multi && card.status && status && <StatusBadge status={status} />}
            </span>
          )}
          {multi ? (
            // A split card lists every pane's session with its own directory,
            // instead of the tab-level block that follows only the focused pane.
            <span className={`${editing ? "mt-1 " : ""}block space-y-1.5`}>
              {sessions.map((session, i) => (
                <SessionBlock
                  key={session.leafId}
                  session={session}
                  titles={titles}
                  showStatus={card.status}
                  active={session.leafId === tab.activeLeafId}
                  divider={i > 0}
                  info={session.cwd ? infos[session.cwd] : undefined}
                  pr={(card.pr && session.cwd && prs[session.cwd]) || undefined}
                  showBranch={card.branch}
                  showCwd={card.cwd}
                />
              ))}
            </span>
          ) : (
            <>
              <BranchBlock
                info={info}
                cwd={cwd}
                agent={cardAgent}
                showBranch={card.branch}
                showCwd={card.cwd}
              />
              {card.pr && pr && (
                <span className="mt-0.5 flex">
                  <PrBadge pr={pr} />
                </span>
              )}
            </>
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
    </Tooltip>
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
  const [nameRef, nameTruncated] = useIsTruncated(name);

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
        {editing ? (
          <>
            {collapsed ? (
              <ChevronRight size={13} className="shrink-0 text-fg-subtle" />
            ) : (
              <ChevronDown size={13} className="shrink-0 text-fg-subtle" />
            )}
            <Folder size={14} className="shrink-0 text-fg-subtle" />
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
          </>
        ) : (
          // The chevron and folder live inside the toggle button so the whole
          // row (not just the name text) collapses/expands the group.
          <Tooltip label={nameTruncated && name} className="min-w-0 flex-1">
            <button
              type="button"
              aria-expanded={!collapsed}
              // Collapse/expand only — activating the space here would yank
              // the main view over to this group's tab.
              onClick={() => setCollapsed((c) => !c)}
              className="flex min-w-0 flex-1 items-center gap-1 text-left"
            >
              {collapsed ? (
                <ChevronRight size={13} className="shrink-0 text-fg-subtle" />
              ) : (
                <ChevronDown size={13} className="shrink-0 text-fg-subtle" />
              )}
              <Folder size={14} className="shrink-0 text-fg-subtle" />
              <span ref={nameRef} className="min-w-0 flex-1 truncate text-xs font-semibold text-fg">
                {name}
              </span>
            </button>
          </Tooltip>
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
  const sessionIds = useSessionStatusStore((s) => s.sessionIds);
  // Dedupe so multiple tabs in the same directory don't trigger redundant IPC
  // and network lookups for that directory. Split panes are listed
  // individually because a multi-session card shows each pane's own directory.
  const cwds = useMemo(
    () =>
      Array.from(
        new Set(
          tabs.flatMap((tab) => [
            deriveTabCwd(tab),
            ...computeLayout(tab.paneTree).flatMap((pane) =>
              pane.content.kind === "terminal" ? [pane.content.cwd ?? tab.cwd ?? null] : [],
            ),
          ]),
        ),
      ).filter((cwd): cwd is string => cwd !== null),
    [tabs],
  );
  useWorktreeInfos(cwds);
  // Titles use the exact Claude session id when known, and retain the legacy
  // cwd + agent key otherwise (including Codex).
  const titleTargets = useMemo(
    () =>
      tabs.flatMap((tab) =>
        collectTabSessions(tab, statuses, leafAgents, sessionIds).flatMap((session) =>
          session.cwd && session.agent
            ? [
                {
                  cwd: session.cwd,
                  agent: session.agent,
                  sessionId: session.sessionId,
                  leafId: session.leafId,
                },
              ]
            : [],
        ),
      ),
    [tabs, statuses, leafAgents, sessionIds],
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
