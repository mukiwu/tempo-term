import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  ClipboardList,
  File,
  FileDiff,
  Folder,
  FolderOpen,
  FolderTree,
  GitBranch,
  GitCompare,
  List,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  SquarePlus,
  Undo2,
  UploadCloud,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InfoDialog } from "@/components/InfoDialog";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Resizer } from "@/components/Resizer";
import { fsReveal } from "@/modules/explorer/lib/fsBridge";
import {
  gitCommit,
  gitDiff,
  gitLog,
  gitPush,
  gitResolveRepo,
  gitRestoreFile,
  gitStage,
  gitStatus,
  gitUnstage,
  type CommitInfo,
  type FileStatus,
  type GitStatus,
} from "./lib/gitBridge";
import { Tooltip } from "@/components/Tooltip";
import {
  buildFileTree,
  collectDescendantFiles,
  flattenFileTree,
  type TreeNode,
} from "@/lib/fileTree";
import { useCollapsedPaths } from "@/lib/useCollapsedPaths";
import { usePendingGraphSelectionStore } from "@/modules/git-graph/lib/pendingGraphSelectionStore";
import { edgePath } from "@/modules/git-graph/lib/graphLayout";
import { BRANCH_COLORS } from "@/modules/git-graph/lib/branchColors";
import { generateCommitMessage } from "./lib/aiCommit";
import { withMinDuration } from "@/lib/withMinDuration";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { STATUS_COLOR } from "./lib/fileStatus";
import { activeAllChangesPane, activeDiffPane, useTabsStore } from "@/stores/tabsStore";
import { useAllChangesLinkStore } from "@/modules/diff/lib/allChangesLinkStore";
import { readComparison } from "@/modules/diff/lib/comparisonBaseStore";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { computeHistoryGraphLayout, HISTORY_GRAPH_GEOMETRY } from "./lib/commitGraph";

type ViewMode = "flat" | "folder";

// Local git reads finish almost instantly; keep the refresh spinner up at least
// this long so the feedback is perceptible.
const MIN_REFRESH_MS = 400;

// The history pane is drag-resizable and its height outlives the session, the
// same deal as the Git Graph details pane.
const COLLAPSED_SECTIONS_KEY = "tempoterm-sourcecontrol-collapsed-sections";
const VIEW_MODE_KEY = "tempoterm-sourcecontrol-view-mode";
const HISTORY_HEIGHT_KEY = "tempoterm-sourcecontrol-history-height";
const HISTORY_HEIGHT_DEFAULT = 200;
const HISTORY_HEIGHT_MIN = 60;
const HISTORY_HEIGHT_MAX = 600;

/**
 * Trailing strip of per-row action buttons, revealed on hover.
 *
 * Collapsed to zero width rather than `opacity-0`: the panel is narrow and the
 * paths in it are long, and an invisible-but-present strip still reserved its
 * width on every row, truncating names against a permanent blank gutter.
 * Width (not `hidden`) keeps the buttons focusable, and `group-focus-within`
 * expands the strip when one is tabbed to — with `display: none` they'd drop
 * out of the tab order entirely. Clipping is only needed while collapsed, so
 * it lifts on expand: the global `:focus-visible` outline (index.css) is
 * painted outside the strip's box and would otherwise be cut off. Every action
 * hidden here is also reachable from the row's context menu.
 *
 * The parent row must carry `group` and its own `focus-within` fill, so a
 * strip revealed by tabbing doesn't sit on bare background.
 */
function RowActions({ revealed = false, children }: { revealed?: boolean; children: ReactNode }) {
  return (
    <div
      className={`flex shrink-0 items-center gap-1 ${
        revealed
          ? "pl-2"
          : "w-0 overflow-hidden group-hover:w-auto group-hover:overflow-visible group-hover:pl-2 group-focus-within:w-auto group-focus-within:overflow-visible group-focus-within:pl-2"
      }`}
    >
      {children}
    </div>
  );
}

function StatusRow({
  file,
  displayPath,
  repoPath,
  actionIcon: ActionIcon,
  actionLabel,
  onAction,
  onOpen,
  onRequestDiscard,
  active = false,
  readOnly = false,
  followsPage = false,
  indent = 0,
}: {
  file: FileStatus;
  displayPath?: string;
  repoPath: string;
  actionIcon: typeof Plus;
  actionLabel: string;
  onAction: (path: string) => void;
  /** Left-click on the row: open this file's diff tab. */
  onOpen: (path: string) => void;
  /** Present on tracked unstaged rows only: ask to discard this file. */
  onRequestDiscard?: (path: string) => void;
  /** This file's diff is the one on screen: the row stays highlighted and
   * keeps its actions out without needing hover. */
  active?: boolean;
  /**
   * Nothing here can be acted on: the page is comparing against something
   * other than the working tree, where staging and discarding have no
   * meaning. The row still opens and still marks itself.
   */
  readOnly?: boolean;
  /**
   * The all-changes page has the pane in front, so this row takes its mark
   * from what that page is showing rather than from a diff pane.
   */
  followsPage?: boolean;
  /** Tree depth for indentation; 0 (default) matches flat mode's spacing. */
  indent?: number;
}) {
  const { t } = useTranslation("sourceControl");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const discardable = !readOnly && onRequestDiscard && file.status !== "?";
  const absPath = `${repoPath}/${file.path}`;
  const rowRef = useRef<HTMLLIElement>(null);

  /**
   * Asked here, per row, rather than handed down from the panel: the file the
   * all-changes page is showing changes as it is scrolled, and a mark read at
   * the top would re-render every row (and the commit graph under them) each
   * time the page crossed into another file. A selector returning a boolean
   * re-renders the two rows that actually change hands and nothing else.
   */
  const pane = useTabsStore((s) => activeAllChangesPane(s.tabs, s.activeId));
  const isShownByPage = useAllChangesLinkStore((s) => {
    const showing = pane ? s.showing[pane] : undefined;
    return showing?.rel === file.path && showing?.staged === file.staged;
  });
  const onPage = followsPage && isShownByPage;
  const marked = active || onPage;

  // A mark you cannot see says nothing, and with dozens of files it leaves the
  // list within a screenful of scrolling. "nearest" is the whole point: a row
  // already in view is left alone, so the list does not chase the page while
  // the reader is looking at it, and one that has gone off the edge comes back
  // by the shortest distance rather than jumping to the middle.
  useEffect(() => {
    if (onPage) {
      rowRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [onPage]);

  const menuItems: ContextMenuItem[] = [
    {
      id: "openFile",
      label: t("menuOpenFile"),
      icon: File,
      group: 0,
      onSelect: () => useTabsStore.getState().openFromSidebar({ kind: "editor", path: absPath }),
    },
    {
      id: "openInNewTab",
      label: t("menuOpenInNewTab"),
      icon: SquarePlus,
      group: 0,
      onSelect: () => useTabsStore.getState().openInNewTab({ kind: "editor", path: absPath }),
    },
    {
      id: "showDiff",
      label: t("menuShowDiff"),
      icon: GitCompare,
      group: 0,
      // Deliberately not onOpen: a left click follows the all-changes page
      // when that is in front, and this is the way to the single-file tab
      // that stays put. Same direct store call as the two items above.
      onSelect: () => useTabsStore.getState().openDiffTab(absPath, file.staged),
    },
    ...(readOnly
      ? []
      : [
          {
            id: "stageAction",
            label: actionLabel,
            icon: ActionIcon,
            group: 1,
            onSelect: () => onAction(file.path),
          } satisfies ContextMenuItem,
        ]),
    {
      id: "copyPath",
      label: t("menuCopyPath"),
      icon: Clipboard,
      group: 2,
      onSelect: () => void navigator.clipboard.writeText(absPath),
    },
    {
      id: "copyRelativePath",
      label: t("menuCopyRelativePath"),
      icon: ClipboardList,
      group: 2,
      onSelect: () => void navigator.clipboard.writeText(file.path),
    },
    {
      id: "reveal",
      label: t("menuRevealFinder"),
      icon: FolderOpen,
      group: 2,
      onSelect: () => void fsReveal(absPath),
    },
    ...(discardable
      ? [
          {
            id: "discard",
            label: t("discard"),
            icon: Undo2,
            group: 3,
            danger: true,
            onSelect: () => onRequestDiscard(file.path),
          } satisfies ContextMenuItem,
        ]
      : []),
  ];

  return (
    <li
      onClick={() => onOpen(file.path)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      ref={rowRef}
      aria-current={marked ? "true" : undefined}
      style={{ paddingLeft: `${indent * 14 + 12}px` }}
      className={`group flex cursor-pointer items-center py-1 pr-3 text-sm ${
        marked ? "bg-bg-elevated" : "hover:bg-bg-elevated/60 focus-within:bg-bg-elevated/60"
      }`}
    >
      <span
        className={`mr-2 w-3 shrink-0 text-center font-mono text-xs ${
          STATUS_COLOR[file.status] ?? "text-fg-muted"
        }`}
      >
        {file.status}
      </span>
      <Tooltip label={file.path} className="min-w-0 flex-1">
        <span className={`min-w-0 flex-1 truncate ${marked ? "text-fg" : "text-fg-muted"}`}>
          {displayPath ?? file.path}
        </span>
      </Tooltip>
      {/* Not rendered at all, rather than hidden: RowActions collapses the
          strip to zero width and deliberately keeps its buttons focusable,
          so leaving them in would put controls that do nothing into the tab
          order and in front of a screen reader. */}
      {!readOnly && (
      <RowActions revealed={marked}>
        {discardable && (
          <Tooltip label={t("discard")}>
            <button
              type="button"
              aria-label={t("discard")}
              onClick={(e) => {
                e.stopPropagation();
                onRequestDiscard(file.path);
              }}
              className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-danger"
            >
              <Undo2 size={14} />
            </button>
          </Tooltip>
        )}
        <Tooltip label={actionLabel}>
          <button
            type="button"
            aria-label={actionLabel}
            onClick={(e) => {
              e.stopPropagation();
              onAction(file.path);
            }}
            className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
          >
            <ActionIcon size={14} />
          </button>
        </Tooltip>
      </RowActions>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </li>
  );
}

function HistoryRow({ commit, repoPath }: { commit: CommitInfo; repoPath: string | null }) {
  const { t } = useTranslation("sourceControl");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function viewInGraph() {
    usePendingGraphSelectionStore.getState().request(commit.id);
    useTabsStore.getState().openGitGraphTab();
  }

  /**
   * Read this commit on the all-changes page, which is a whole tab rather than
   * the few hundred pixels the graph's details panel gets. "The changes in
   * this commit" is the range from its parent; a root commit has none, so
   * there is nothing to offer.
   */
  const readable = repoPath && commit.parents.length > 0;
  function openInPage() {
    if (repoPath) {
      readComparison(repoPath, commit.id);
    }
  }

  return (
    <li
      onClick={viewInGraph}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{ height: `${HISTORY_GRAPH_GEOMETRY.rowHeight}px` }}
      className="group flex cursor-pointer items-center gap-2 pr-2 text-xs hover:bg-bg-elevated/60"
    >
      <span className="shrink-0 font-mono text-fg-subtle">{commit.id}</span>
      <span className="min-w-0 flex-1 truncate text-fg-muted">{commit.summary}</span>
      {/* Hover only: this list is long and one permanent icon per row would
          eat width the subjects need. The row's own click still goes to the
          graph, so this one has to stop there. */}
      {readable && (
        <RowActions>
          <Tooltip label={t("openChangesInTab")}>
            <button
              type="button"
              aria-label={t("openChangesInTab")}
              onClick={(e) => {
                e.stopPropagation();
                openInPage();
              }}
              className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
            >
              <FileDiff size={13} />
            </button>
          </Tooltip>
        </RowActions>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              id: "viewInGraph",
              label: t("menuViewInGraph"),
              icon: GitCompare,
              group: 0,
              onSelect: viewInGraph,
            },
            {
              id: "copyHash",
              label: t("menuCopyHash"),
              icon: Clipboard,
              group: 1,
              onSelect: () => void navigator.clipboard.writeText(commit.id),
            },
            {
              id: "copyMessage",
              label: t("menuCopyMessage"),
              icon: ClipboardList,
              group: 1,
              onSelect: () => void navigator.clipboard.writeText(commit.summary),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </li>
  );
}

/**
 * Compact SVG rail drawn beside the history list: one dot per commit and a
 * connector per parent link, laid out with `HISTORY_GRAPH_GEOMETRY` so each
 * row lines up with its `HistoryRow` counterpart. Kept intentionally narrow
 * (see HISTORY_GRAPH_GEOMETRY) — this is a compact indicator of order,
 * divergence and merges, not the full interactive Git Graph tab.
 */
function HistoryGraphColumn({ commits }: { commits: CommitInfo[] }) {
  const { layouts, edges } = useMemo(() => computeHistoryGraphLayout(commits), [commits]);
  const width =
    HISTORY_GRAPH_GEOMETRY.paddingLeft +
    HISTORY_GRAPH_GEOMETRY.maxLane * HISTORY_GRAPH_GEOMETRY.laneWidth +
    18;
  const height = commits.length * HISTORY_GRAPH_GEOMETRY.rowHeight;

  return (
    <svg width={width} height={height} className="history-graph shrink-0" aria-hidden="true">
      {edges.map((edge, idx) => (
        <path
          key={`edge-${idx}`}
          d={edgePath(edge, HISTORY_GRAPH_GEOMETRY.rowHeight)}
          fill="none"
          stroke={BRANCH_COLORS[edge.colorIndex % BRANCH_COLORS.length]}
          strokeWidth={1.5}
          className="opacity-80"
        />
      ))}
      {commits.map((commit, index) => {
        const layout = layouts[commit.id];
        if (!layout) {
          return null;
        }
        // The history list is always rooted at HEAD (git log walks from
        // HEAD), so the first row is always the current commit.
        const isHead = index === 0;
        return (
          <circle
            key={commit.id}
            cx={layout.x}
            cy={layout.y}
            r={isHead ? 3.5 : 2.5}
            fill={isHead ? "var(--color-accent)" : BRANCH_COLORS[layout.colorIndex % BRANCH_COLORS.length]}
          />
        );
      })}
    </svg>
  );
}

function basename(path: string): string {
  // git reports an untracked directory as a path ending in "/"; keep the slash
  // in the label so it still reads as a folder instead of a blank name.
  const isDir = path.endsWith("/");
  const normalized = isDir ? path.slice(0, -1) : path;
  const name = normalized.split("/").pop() || normalized;
  return isDir ? `${name}/` : name;
}

/**
 * Recursively renders one level of a changed-files tree: folder headers with
 * a collapse toggle and a subtree-wide action button, file rows via StatusRow.
 */
/**
 * One folder in the tree: its header, and its children when it is open.
 *
 * Split out of FileTreeRows so it can hold a subscription of its own. A
 * collapsed folder renders none of its files, so when the all-changes page
 * scrolls into one of them there is no row to mark and the panel goes quiet
 * about where the reader is. The folder takes the mark instead: the tree says
 * where you are at whatever granularity is on screen -- the folder while it is
 * shut, the file once it is open.
 *
 * Opening it by itself was the other option and is worse. Scrolling is
 * continuous, so it would not be one folder opening but every folder the
 * reader passes, and by the end of a long page the tree they had arranged is
 * fully expanded. Collapse state belongs to the reader (#380), which is the
 * same reason this feature leaves the panel's sections alone.
 */
function FolderRow({
  node,
  depth,
  isCollapsed,
  onToggleCollapse,
  actionIcon: ActionIcon,
  folderActionLabel,
  onFolderAction,
  readOnly,
  followsPage,
  children,
}: {
  node: TreeNode<FileStatus> & { kind: "folder" };
  depth: number;
  isCollapsed: boolean;
  onToggleCollapse: (path: string) => void;
  actionIcon: typeof Plus;
  folderActionLabel: string;
  onFolderAction: (paths: string[]) => void;
  /** Nothing here can be staged, so the subtree action goes too -- it was the
   * one button still showing after the file rows lost theirs. */
  readOnly?: boolean;
  followsPage?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation("sourceControl");
  const rowRef = useRef<HTMLLIElement>(null);

  // A boolean per folder row, for the same reason StatusRow asks per file: a
  // reading taken at the top would re-render the whole tree every time the
  // page crossed into another file.
  const pane = useTabsStore((s) => activeAllChangesPane(s.tabs, s.activeId));
  const holdsShownFile = useAllChangesLinkStore((s) => {
    const showing = pane ? s.showing[pane] : undefined;
    return showing ? showing.rel.startsWith(`${node.path}/`) : false;
  });
  // Only while shut. Open, the file's own row carries the mark and marking the
  // folder too would say the same thing twice.
  const onPage = Boolean(followsPage) && isCollapsed && holdsShownFile;

  useEffect(() => {
    if (onPage) {
      rowRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [onPage]);

  return (
    <li ref={rowRef} aria-current={onPage ? "true" : undefined}>
      <div
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
        className={`group flex items-center gap-1 py-1 pr-3 text-sm ${
          onPage ? "bg-bg-elevated" : "hover:bg-bg-elevated/60 focus-within:bg-bg-elevated/60"
        }`}
      >
        {/* The whole label — chevron, icon and name — is the toggle, the
            way the section headers and the Git Graph details tree work.
            Aiming for the 13px chevron alone was the only way to open a
            folder here. The subtree action stays a sibling button, so it
            never toggles the folder it acts on. Hover is the row
            background only, never a text colour: in this list a bright
            label means "this is the file you are viewing" (StatusRow's
            active row), and nothing else. */}
        <button
          type="button"
          onClick={() => onToggleCollapse(node.path)}
          aria-label={
            isCollapsed
              ? t("expandFolder", { name: node.path })
              : t("collapseFolder", { name: node.path })
          }
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-fg-subtle"
        >
          {isCollapsed ? (
            <ChevronRight size={13} className="shrink-0" />
          ) : (
            <ChevronDown size={13} className="shrink-0" />
          )}
          <Folder size={13} className="shrink-0" />
          <Tooltip label={node.path} className="min-w-0 flex-1">
            <span className={`min-w-0 flex-1 truncate ${onPage ? "text-fg" : "text-fg-muted"}`}>
              {node.name}
            </span>
          </Tooltip>
        </button>
        {/* Permanently revealed, like the section headers: folder rows
            have no context menu to fall back on for pointers with no
            hover, and one icon costs little of the width the file rows'
            hover-reveal exists to reclaim. */}
        {!readOnly && (
        <RowActions revealed>
          <Tooltip label={`${folderActionLabel}: ${node.path}`}>
            <button
              type="button"
              aria-label={`${folderActionLabel}: ${node.path}`}
              onClick={() => onFolderAction(collectDescendantFiles(node).map((f) => f.path))}
              className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
            >
              <ActionIcon size={14} />
            </button>
          </Tooltip>
        </RowActions>
        )}
      </div>
      {!isCollapsed && <ul>{children}</ul>}
    </li>
  );
}

function FileTreeRows({
  nodes,
  depth,
  collapsed,
  onToggleCollapse,
  repoPath,
  actionIcon: ActionIcon,
  actionLabel,
  folderActionLabel,
  onFileAction,
  onFolderAction,
  onFileOpen,
  onRequestDiscard,
  activePath,
  readOnly,
  followsPage,
}: {
  nodes: TreeNode<FileStatus>[];
  depth: number;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  repoPath: string;
  actionIcon: typeof Plus;
  actionLabel: string;
  folderActionLabel: string;
  onFileAction: (path: string) => void;
  onFolderAction: (paths: string[]) => void;
  onFileOpen: (path: string) => void;
  onRequestDiscard?: (path: string) => void;
  activePath?: string | null;
  readOnly?: boolean;
  followsPage?: boolean;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "file") {
          return (
            <StatusRow
              key={node.path}
              file={node.file}
              // basename (not node.name) re-appends the trailing "/" git
              // status uses for an untracked directory, e.g. "dir/" — the
              // tree's own `name` is the bare segment "dir", used for
              // sorting/keys, not display.
              displayPath={basename(node.file.path)}
              repoPath={repoPath}
              actionIcon={ActionIcon}
              actionLabel={actionLabel}
              onAction={onFileAction}
              onOpen={onFileOpen}
              onRequestDiscard={onRequestDiscard}
              active={node.file.path === activePath}
              readOnly={readOnly}
              followsPage={followsPage}
              indent={depth}
            />
          );
        }
        const isCollapsed = collapsed.has(node.path);
return (
          <FolderRow
            key={node.path}
            node={node}
            depth={depth}
            isCollapsed={isCollapsed}
            onToggleCollapse={onToggleCollapse}
            actionIcon={ActionIcon}
            folderActionLabel={folderActionLabel}
            onFolderAction={onFolderAction}
            readOnly={readOnly}
            followsPage={followsPage}
          >
            <FileTreeRows
              nodes={node.children}
              depth={depth + 1}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              repoPath={repoPath}
              actionIcon={ActionIcon}
              actionLabel={actionLabel}
              folderActionLabel={folderActionLabel}
              onFileAction={onFileAction}
              onFolderAction={onFolderAction}
              onFileOpen={onFileOpen}
              onRequestDiscard={onRequestDiscard}
              activePath={activePath}
              readOnly={readOnly}
              followsPage={followsPage}
            />
          </FolderRow>
        );
      })}
    </>
  );
}

/**
 * Renders a set of changed files either flat (one row per file, full path) or
 * as a nested folder tree. In tree mode each folder header carries a button
 * that runs the same action across every file in its whole subtree (stage /
 * unstage), and folders can be collapsed independently per section.
 */
function FileList({
  files,
  viewMode,
  actionIcon,
  actionLabel,
  folderActionLabel,
  repoPath,
  onFileAction,
  onFolderAction,
  onFileOpen,
  onRequestDiscard,
  activePath,
  readOnly,
  followsPage,
}: {
  files: FileStatus[];
  viewMode: ViewMode;
  actionIcon: typeof Plus;
  actionLabel: string;
  folderActionLabel: string;
  repoPath: string;
  onFileAction: (path: string) => void;
  onFolderAction: (paths: string[]) => void;
  onFileOpen: (path: string) => void;
  onRequestDiscard?: (path: string) => void;
  /** Repo-relative path of the file whose diff is on screen, if it is in this
   * list — the staged and unstaged lists never claim it at the same time. */
  activePath?: string | null;
  readOnly?: boolean;
  followsPage?: boolean;
}) {
  const { collapsed, toggle: toggleFolder } = useCollapsedPaths();

  if (viewMode === "flat") {
    return (
      <ul>
        {/* Ordered by the same tree the folder view draws, just without the
            folder rows: one directory's changes stay together instead of
            landing wherever status happened to report them, and the flat
            list, the folder view and the all-changes page then read as one
            index rather than three sorts of the same files. */}
        {flattenFileTree(buildFileTree(files)).map((file) => (
          <StatusRow
            key={file.path}
            file={file}
            repoPath={repoPath}
            actionIcon={actionIcon}
            actionLabel={actionLabel}
            onAction={onFileAction}
            onOpen={onFileOpen}
            onRequestDiscard={onRequestDiscard}
            active={file.path === activePath}
            readOnly={readOnly}
            followsPage={followsPage}
          />
        ))}
      </ul>
    );
  }

  return (
    <ul>
      <FileTreeRows
        nodes={buildFileTree(files)}
        depth={0}
        collapsed={collapsed}
        onToggleCollapse={toggleFolder}
        repoPath={repoPath}
        actionIcon={actionIcon}
        actionLabel={actionLabel}
        folderActionLabel={folderActionLabel}
        onFileAction={onFileAction}
        onFolderAction={onFolderAction}
        onFileOpen={onFileOpen}
        onRequestDiscard={onRequestDiscard}
        activePath={activePath}
        readOnly={readOnly}
        followsPage={followsPage}
      />
    </ul>
  );
}

/** Keys of the collapsible sections, a closed set so typos fail typecheck. */
type SectionKey = "staged" | "changes" | "history";

const SECTION_KEYS: SectionKey[] = ["staged", "changes", "history"];

/** Collapsed sections as last left by the user; an unreadable value just means
 *  "nothing collapsed", never a crash. */
function readCollapsedSections(): Set<SectionKey> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_KEY) ?? "[]");
    const keys = Array.isArray(raw)
      ? raw.filter((k): k is SectionKey => SECTION_KEYS.includes(k as SectionKey))
      : [];
    return new Set(keys);
  } catch {
    return new Set();
  }
}

/**
 * Collapsible section heading. The toggle is a real button stretched across
 * the row (like WorkspacePanel's group headers) so it works from the keyboard
 * and reports its state; `action` (e.g. the "stage all" button) sits outside
 * it at the trailing edge, so its clicks never reach the toggle. Unlike the
 * file rows' actions it stays permanently revealed: a header has no context
 * menu to fall back on for pointers with no hover, "Stage all" had always been
 * visible before the hover-reveal landed, and one action per header costs no
 * width worth reclaiming. It also stays available while the section is
 * collapsed, so e.g. staging everything doesn't require expanding first.
 */
function SectionHeader({
  label,
  verbatim = false,
  collapsed,
  onToggle,
  action,
}: {
  label: string;
  /** Show the label as given rather than in caps: it is a name, not a word. */
  verbatim?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="group flex items-center justify-between px-3 py-1 text-fg-subtle hover:bg-bg-elevated/60 focus-within:bg-bg-elevated/60 hover:text-fg">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className={`flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold tracking-wide ${
          // "Staged"/"Changes" are the panel's own words and read as headings
          // in caps. A ref name is not the panel's to rewrite: refs are
          // case-sensitive, so MASTER is a different thing from master, and a
          // branch called feat/AllChanges comes out misspelt.
          verbatim ? "" : "uppercase"
        }`}
      >
        {collapsed ? (
          <ChevronRight size={12} className="shrink-0" />
        ) : (
          <ChevronDown size={12} className="shrink-0" />
        )}
        <span className="truncate">{label}</span>
      </button>
      {action && <RowActions revealed>{action}</RowActions>}
    </div>
  );
}

export function SourceControlView() {
  const { t } = useTranslation("sourceControl");
  const { t: tCommon } = useTranslation("common");
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [history, setHistory] = useState<CommitInfo[]>([]);
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    localStorage.getItem(VIEW_MODE_KEY) === "folder" ? "folder" : "flat",
  );
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);
  const [refreshing, setRefreshing] = useState(false);
  const [historyHeight, setHistoryHeight] = useState<number>(() => {
    const v = Number(localStorage.getItem(HISTORY_HEIGHT_KEY));
    return Number.isFinite(v) && v > 0 ? v : HISTORY_HEIGHT_DEFAULT;
  });
  const historyHeightRef = useRef(historyHeight);
  historyHeightRef.current = historyHeight;
  const persistHistoryHeight = useCallback(() => {
    localStorage.setItem(HISTORY_HEIGHT_KEY, String(historyHeightRef.current));
  }, []);
  // Section headers the user has collapsed. Remembered across sessions, like
  // the history pane's height — reopening the panel should not undo the layout.
  const [collapsedSections, setCollapsedSections] = useState<Set<SectionKey>>(
    readCollapsedSections,
  );
  const toggleSection = useCallback((key: SectionKey) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  useEffect(() => {
    localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...collapsedSections]));
  }, [collapsedSections]);
  const providerId = useChatStore((s) => s.providerId);
  const model = useChatStore((s) => s.model);
  const customBaseUrl = useChatStore((s) => s.customBaseUrl);
  const openDiffTab = useTabsStore((s) => s.openDiffTab);
  const toggleAllChangesTab = useTabsStore((s) => s.toggleAllChangesTab);
  // While the all-changes page is the pane in front, this panel is its table
  // of contents rather than a way of opening more tabs.
  const allChangesPane = useTabsStore((s) => activeAllChangesPane(s.tabs, s.activeId));
  const allChangesInFront = allChangesPane !== null;
  // What the page in front is comparing, when that is no longer the working
  // tree. While one of these is up, this panel is that page's index rather
  // than a view of the working tree -- listing what status reports would be
  // describing a different comparison in the same breath. Read from the pane
  // in front for the same reason the mark is: a split can hold two pages, each
  // comparing something else.
  const listing = useAllChangesLinkStore((s) => (allChangesPane ? s.listing[allChangesPane] : undefined) ?? null);
  // Which row is "the one on screen": the diff in the foreground pane. Read as
  // two primitives — a selector returning a fresh {path, staged} object would
  // never compare equal, re-rendering the panel on every store change.
  const activeDiffPath = useTabsStore((s) => activeDiffPane(s.tabs, s.activeId)?.path ?? null);
  const activeDiffStaged = useTabsStore((s) => activeDiffPane(s.tabs, s.activeId)?.staged ?? false);
  // Repo-relative path of the file awaiting discard confirmation, if any.
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  // Basename of a file whose discard failed, shown in an error dialog.
  const [discardError, setDiscardError] = useState<string | null>(null);

  // Rows report repo-relative paths; the diff tab (like the editor) wants an
  // absolute path so it can resolve the repo on its own.
  const openDiff = useCallback(
    (path: string, staged: boolean) => {
      // With the all-changes page in front, a row scrolls it to that file
      // instead of opening a tab per file, which is the whole point of that
      // page. The right-click menu's "Show Diff" still opens the single-file
      // tab, so nothing is only reachable one way.
      // The page in front, not "a page somewhere": a split can hold two, and
      // the rows being clicked belong to the one being looked at.
      if (allChangesPane) {
        useAllChangesLinkStore.getState().request(allChangesPane, { rel: path, staged });
        return;
      }
      if (repoPath) {
        openDiffTab(`${repoPath}/${path}`, staged);
      }
    },
    [allChangesPane, repoPath, openDiffTab],
  );

  const refresh = useCallback(async () => {
    if (!repoPath) {
      return;
    }
    setRefreshing(true);
    // Whatever else is reading this repo reloads with it: the all-changes page
    // shows the same list, from the same status call, and a refresh that moved
    // only one of them would leave the two disagreeing side by side.
    // Read at the moment of pressing, not closed over: this callback is
    // memoised on the repo, and the pane in front changes far more often than
    // that -- captured, it would still be the answer from the first render.
    const { tabs, activeId } = useTabsStore.getState();
    const pane = activeAllChangesPane(tabs, activeId);
    if (pane) {
      useAllChangesLinkStore.getState().requestRescan(pane);
    }
    try {
      await withMinDuration(
        (async () => {
          setStatus(await gitStatus(repoPath));
          setHistory(await gitLog(repoPath, 20));
        })(),
        MIN_REFRESH_MS,
      );
    } catch {
      // ignore transient git errors
    } finally {
      setRefreshing(false);
    }
  }, [repoPath]);

  useEffect(() => {
    if (!rootPath) {
      return;
    }
    gitResolveRepo(rootPath)
      .then((repo) => {
        setRepoPath(repo);
        setResolved(true);
      })
      .catch(() => setResolved(true));
  }, [rootPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (resolved && !repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-subtle">
        <GitBranch size={48} strokeWidth={1} />
        <p className="text-sm">{t("noRepo")}</p>
      </div>
    );
  }

  // Rows key off repo-relative paths; the diff pane carries an absolute one.
  // A diff opened from somewhere else (another repo, the git graph) simply
  // matches no row.
  const diffRelPath =
    repoPath && activeDiffPath?.startsWith(`${repoPath}/`)
      ? activeDiffPath.slice(repoPath.length + 1)
      : null;
  // #364's mark for a diff pane. The all-changes page's own mark is asked for
  // by each row instead (see StatusRow), so that scrolling that page does not
  // re-render the whole panel every time it crosses into another file.
  const activeRelPath = diffRelPath;
  const activeStaged = activeDiffStaged;

  const canCommit = message.trim().length > 0 && (status?.staged.length ?? 0) > 0;
  const hasStaged = (status?.staged.length ?? 0) > 0;

  async function withRepo(fn: (repo: string) => Promise<void>) {
    if (!repoPath) {
      return;
    }
    await fn(repoPath);
    await refresh();
  }

  async function aiGenerate() {
    if (!repoPath || generating) {
      return;
    }
    setGenerating(true);
    try {
      const diff = await gitDiff(repoPath, true);
      if (diff.trim()) {
        setMessage(await generateCommitMessage(diff, providerId, model, customBaseUrl));
      }
    } catch {
      // leave the message as-is on failure
    } finally {
      setGenerating(false);
    }
  }

  async function doPush() {
    if (!repoPath || pushing) {
      return;
    }
    setPushing(true);
    try {
      await gitPush(repoPath);
      await refresh();
    } catch {
      // a toast surface comes later
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-bg-inset">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          {t("title")}
        </span>
        <div className="flex items-center gap-0.5">
          {/* Filled while the page is the pane in front, which is the state
              worth showing: that is when this panel stops opening tabs and
              starts following the page, and when the commit box steps out.
              Something has to account for that, and this button is the only
              thing on screen that can. Open-but-behind is deliberately drawn
              the same as shut -- the button speaks about the pane in front,
              not about what exists somewhere in the space. Same on/off looks
              as the wrap button in DiffTabContent, and the icon never changes:
              it is the all-changes tab's own icon, and that match is what
              makes the button legible in the first place. */}
          <Tooltip label={allChangesInFront ? t("allChangesClose") : t("allChanges")}>
            <button
              type="button"
              aria-label={allChangesInFront ? t("allChangesClose") : t("allChanges")}
              aria-pressed={allChangesInFront}
              onClick={() => toggleAllChangesTab()}
              className={`rounded p-1 ${
                allChangesInFront
                  ? "bg-bg-elevated text-fg"
                  : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
              }`}
            >
              <FileDiff size={14} />
            </button>
          </Tooltip>
          <Tooltip label={viewMode === "flat" ? t("viewFolder") : t("viewFlat")}>
            <button
              type="button"
              aria-label={viewMode === "flat" ? t("viewFolder") : t("viewFlat")}
              onClick={() => setViewMode((m) => (m === "flat" ? "folder" : "flat"))}
              className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
            >
              {viewMode === "flat" ? <FolderTree size={14} /> : <List size={14} />}
            </button>
          </Tooltip>
          <Tooltip label={t("refresh")}>
            <button
              type="button"
              aria-label={t("refresh")}
              onClick={() => void refresh()}
              disabled={refreshing}
              className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:opacity-50"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            </button>
          </Tooltip>
        </div>
      </div>

      {status?.branch && (
        <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-fg-muted">
          <GitBranch size={13} className="text-accent" />
          {status.branch}
        </div>
      )}

      {/* The commit box steps out while the all-changes page is in front:
          nothing is committed from there, and the message box and buttons
          together take a fixed ~76px off the file list that page is being
          read against. It comes straight back when the page does not have
          the pane. Nothing else about the panel moves -- no section is
          collapsed for the reader (#380), no control is relocated. */}
      {!allChangesInFront && (
        <div className="px-3 pb-3">
          <div className="relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("commitPlaceholder")}
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-bg px-2 py-1.5 pr-9 text-sm text-fg outline-none focus:border-accent"
            />
            <Tooltip label={t("aiGenerate")} className="absolute right-1.5 top-1.5">
              <button
                type="button"
                disabled={!hasStaged || generating}
                onClick={() => void aiGenerate()}
                aria-label={t("aiGenerate")}
                className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generating ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Sparkles size={15} />
                )}
              </button>
            </Tooltip>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={!canCommit}
              onClick={() =>
                void withRepo(async (repo) => {
                  await gitCommit(repo, message);
                  setMessage("");
                })
              }
              className="flex-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("commit")}
            </button>
            <button
              type="button"
              disabled={pushing}
              onClick={() => void doPush()}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-40"
            >
              {pushing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <UploadCloud size={14} />
              )}
              {t("push")}
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listing ? (
            <section className="mb-2">
              {/* Read-only, and said so: staging means nothing against a base
                  that is not the working tree, and most of these files are
                  committed already. The header names the base rather than
                  saying "Changes", because what is listed is the difference
                  from that, not from anything on disk. */}
              <SectionHeader
                label={t(listing.range ? "baseDiffSectionRange" : "baseDiffSection", {
                  name: listing.label,
                })}
                verbatim
                collapsed={collapsedSections.has("changes")}
                onToggle={() => toggleSection("changes")}
                action={
                  <span className="shrink-0 text-[11px] text-fg-subtle">{t("readOnly")}</span>
                }
              />
              {!collapsedSections.has("changes") &&
                (listing.files.length === 0 ? (
                  <p className="px-3 py-1 text-xs text-fg-subtle">{t("noChanges")}</p>
                ) : (
                  <FileList
                    files={listing.files.map((file) => ({
                      path: file.rel,
                      staged: false,
                      status: file.status,
                    }))}
                    viewMode={viewMode}
                    actionIcon={Plus}
                    actionLabel={t("stage")}
                    folderActionLabel={t("stageFolder")}
                    // Nothing to act on, so every action is a no-op rather
                    // than a button that half works.
                    onFileAction={() => {}}
                    onFolderAction={() => {}}
                    onFileOpen={(path) => openDiff(path, false)}
                    repoPath={repoPath ?? ""}
                    activePath={null}
                    followsPage={allChangesInFront}
                    readOnly
                  />
                ))}
            </section>
          ) : null}
          {!listing && (status?.staged.length ?? 0) > 0 && (
            <section className="mb-2">
              <SectionHeader
                label={t("stagedChanges")}
                collapsed={collapsedSections.has("staged")}
                onToggle={() => toggleSection("staged")}
                action={
                  <button
                    type="button"
                    onClick={() => {
                      void withRepo(async (repo) => {
                        for (const file of status!.staged) {
                          await gitUnstage(repo, file.path);
                        }
                      });
                    }}
                    className="shrink-0 text-[11px] text-accent hover:underline"
                  >
                    {t("unstageAll")}
                  </button>
                }
              />
              {!collapsedSections.has("staged") && (
                <FileList
                  files={status!.staged}
                  viewMode={viewMode}
                  actionIcon={Minus}
                  actionLabel={t("unstage")}
                  folderActionLabel={t("unstageFolder")}
                  onFileAction={(path) => void withRepo((repo) => gitUnstage(repo, path))}
                  onFolderAction={(paths) =>
                    void withRepo(async (repo) => {
                      for (const path of paths) {
                        await gitUnstage(repo, path);
                      }
                    })
                  }
                  onFileOpen={(path) => openDiff(path, true)}
                  activePath={activeStaged ? activeRelPath : null}
                  followsPage={allChangesInFront}
                  repoPath={repoPath ?? ""}
                />
              )}
            </section>
          )}

          {!listing && (
          <section className="mb-2">
            <SectionHeader
              label={t("changes")}
              collapsed={collapsedSections.has("changes")}
              onToggle={() => toggleSection("changes")}
              action={
                (status?.unstaged.length ?? 0) > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      void withRepo(async (repo) => {
                        for (const file of status!.unstaged) {
                          await gitStage(repo, file.path);
                        }
                      });
                    }}
                    className="shrink-0 text-[11px] text-accent hover:underline"
                  >
                    {t("stageAll")}
                  </button>
                ) : undefined
              }
            />
            {!collapsedSections.has("changes") &&
              ((status?.unstaged.length ?? 0) === 0 ? (
                <p className="px-3 py-1 text-xs text-fg-subtle">{t("noChanges")}</p>
              ) : (
                <FileList
                  files={status!.unstaged}
                  viewMode={viewMode}
                  actionIcon={Plus}
                  actionLabel={t("stage")}
                  folderActionLabel={t("stageFolder")}
                  onFileAction={(path) => void withRepo((repo) => gitStage(repo, path))}
                  onFolderAction={(paths) =>
                    void withRepo(async (repo) => {
                      for (const path of paths) {
                        await gitStage(repo, path);
                      }
                    })
                  }
                  onFileOpen={(path) => openDiff(path, false)}
                  onRequestDiscard={setDiscardTarget}
                  activePath={activeStaged ? null : activeRelPath}
                  followsPage={allChangesInFront}
                  repoPath={repoPath ?? ""}
                />
              ))}
          </section>
          )}
        </div>

        {/* History is its own pane pinned to the bottom of the panel in both
            states, so its header never rides the Changes scroll out of view:
            expanding opens the list upward instead of moving the header. Its
            height is dragged from the top edge and remembered; the max-height
            keeps a squeezed panel from pushing Changes off the top. */}
        {history.length > 0 && !collapsedSections.has("history") && (
          <Resizer
            orientation="horizontal"
            onResize={(delta) =>
              setHistoryHeight((h) =>
                Math.min(HISTORY_HEIGHT_MAX, Math.max(HISTORY_HEIGHT_MIN, h - delta)),
              )
            }
            onResizeEnd={persistHistoryHeight}
          />
        )}
        {history.length > 0 && (
          <section
            style={
              collapsedSections.has("history") ? undefined : { height: `${historyHeight}px` }
            }
            className={`flex min-h-0 shrink-0 flex-col border-t border-border ${
              collapsedSections.has("history") ? "" : "max-h-[70%]"
            }`}
          >
            <SectionHeader
              label={t("history")}
              collapsed={collapsedSections.has("history")}
              onToggle={() => toggleSection("history")}
            />
            {!collapsedSections.has("history") && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex gap-1 px-3 pb-2">
                  <HistoryGraphColumn commits={history} />
                  <ul className="min-w-0 flex-1">
                    {history.map((commit) => (
                      <HistoryRow key={commit.id} commit={commit} repoPath={repoPath} />
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {discardTarget && (
        <ConfirmDialog
          title={t("discardTitle")}
          message={t("discardMessage", { name: basename(discardTarget) })}
          confirmLabel={t("discardConfirm")}
          cancelLabel={tCommon("actions.cancel")}
          onConfirm={() => {
            const target = discardTarget;
            setDiscardTarget(null);
            // A destructive action must never fail silently: surface the
            // error and refresh so the list reflects whatever really happened.
            withRepo((repo) => gitRestoreFile(repo, target)).catch(() => {
              setDiscardError(basename(target));
              void refresh();
            });
          }}
          onCancel={() => setDiscardTarget(null)}
        />
      )}

      {discardError && (
        <InfoDialog
          title={t("discardTitle")}
          message={t("discardFailed", { name: discardError })}
          confirmLabel={tCommon("actions.confirm")}
          onConfirm={() => setDiscardError(null)}
        />
      )}
    </div>
  );
}
