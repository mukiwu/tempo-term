import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  ClipboardList,
  File,
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
import { buildFileTree, collectDescendantFiles, type TreeNode } from "@/lib/fileTree";
import { useCollapsedPaths } from "@/lib/useCollapsedPaths";
import { usePendingGraphSelectionStore } from "@/modules/git-graph/lib/pendingGraphSelectionStore";
import { edgePath } from "@/modules/git-graph/lib/graphLayout";
import { BRANCH_COLORS } from "@/modules/git-graph/lib/branchColors";
import { generateCommitMessage } from "./lib/aiCommit";
import { withMinDuration } from "@/lib/withMinDuration";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { computeHistoryGraphLayout, HISTORY_GRAPH_GEOMETRY } from "./lib/commitGraph";

type ViewMode = "flat" | "folder";

// Local git reads finish almost instantly; keep the refresh spinner up at least
// this long so the feedback is perceptible.
const MIN_REFRESH_MS = 400;

const STATUS_COLOR: Record<string, string> = {
  M: "text-warning",
  A: "text-success",
  D: "text-danger",
  "?": "text-fg-subtle",
  R: "text-accent",
};

function StatusRow({
  file,
  displayPath,
  repoPath,
  actionIcon: ActionIcon,
  actionLabel,
  onAction,
  onOpen,
  onRequestDiscard,
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
  /** Tree depth for indentation; 0 (default) matches flat mode's spacing. */
  indent?: number;
}) {
  const { t } = useTranslation("sourceControl");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const discardable = onRequestDiscard && file.status !== "?";
  const absPath = `${repoPath}/${file.path}`;

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
      onSelect: () => onOpen(file.path),
    },
    {
      id: "stageAction",
      label: actionLabel,
      icon: ActionIcon,
      group: 1,
      onSelect: () => onAction(file.path),
    },
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
      style={{ paddingLeft: `${indent * 14 + 12}px` }}
      className="group flex cursor-pointer items-center gap-2 py-1 pr-3 text-sm hover:bg-bg-elevated/60"
    >
      <span
        className={`w-3 shrink-0 text-center font-mono text-xs ${
          STATUS_COLOR[file.status] ?? "text-fg-muted"
        }`}
      >
        {file.status}
      </span>
      <Tooltip label={file.path} className="min-w-0 flex-1">
        <span className="min-w-0 flex-1 truncate text-fg-muted">
          {displayPath ?? file.path}
        </span>
      </Tooltip>
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
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </li>
  );
}

function HistoryRow({ commit }: { commit: CommitInfo }) {
  const { t } = useTranslation("sourceControl");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function viewInGraph() {
    usePendingGraphSelectionStore.getState().request(commit.id);
    useTabsStore.getState().openGitGraphTab();
  }

  return (
    <li
      onClick={viewInGraph}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{ height: `${HISTORY_GRAPH_GEOMETRY.rowHeight}px` }}
      className="flex cursor-pointer items-center gap-2 text-xs hover:bg-bg-elevated/60"
    >
      <span className="shrink-0 font-mono text-fg-subtle">{commit.id}</span>
      <span className="min-w-0 flex-1 truncate text-fg-muted">{commit.summary}</span>
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
}) {
  const { t } = useTranslation("sourceControl");
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
              indent={depth}
            />
          );
        }
        const isCollapsed = collapsed.has(node.path);
        return (
          <li key={node.path}>
            <div
              style={{ paddingLeft: `${depth * 14 + 12}px` }}
              className="group flex items-center gap-1 py-1 pr-3 text-sm hover:bg-bg-elevated/60"
            >
              <button
                type="button"
                onClick={() => onToggleCollapse(node.path)}
                aria-label={
                  isCollapsed
                    ? t("expandFolder", { name: node.path })
                    : t("collapseFolder", { name: node.path })
                }
                className="flex shrink-0 items-center text-fg-subtle hover:text-fg"
              >
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </button>
              <Folder size={13} className="shrink-0 text-fg-subtle" />
              <Tooltip label={node.path} className="min-w-0 flex-1">
                <span className="min-w-0 flex-1 truncate text-fg-muted">{node.name}</span>
              </Tooltip>
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
            </div>
            {!isCollapsed && (
              <ul>
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
                />
              </ul>
            )}
          </li>
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
}) {
  const { collapsed, toggle: toggleFolder } = useCollapsedPaths();

  if (viewMode === "flat") {
    return (
      <ul>
        {files.map((file) => (
          <StatusRow
            key={file.path}
            file={file}
            repoPath={repoPath}
            actionIcon={actionIcon}
            actionLabel={actionLabel}
            onAction={onFileAction}
            onOpen={onFileOpen}
            onRequestDiscard={onRequestDiscard}
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
      />
    </ul>
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
  const [viewMode, setViewMode] = useState<ViewMode>("flat");
  const [refreshing, setRefreshing] = useState(false);
  const providerId = useChatStore((s) => s.providerId);
  const model = useChatStore((s) => s.model);
  const openDiffTab = useTabsStore((s) => s.openDiffTab);
  // Repo-relative path of the file awaiting discard confirmation, if any.
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  // Basename of a file whose discard failed, shown in an error dialog.
  const [discardError, setDiscardError] = useState<string | null>(null);

  // Rows report repo-relative paths; the diff tab (like the editor) wants an
  // absolute path so it can resolve the repo on its own.
  const openDiff = useCallback(
    (path: string, staged: boolean) => {
      if (repoPath) {
        openDiffTab(`${repoPath}/${path}`, staged);
      }
    },
    [repoPath, openDiffTab],
  );

  const refresh = useCallback(async () => {
    if (!repoPath) {
      return;
    }
    setRefreshing(true);
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
        setMessage(await generateCommitMessage(diff, providerId, model));
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {(status?.staged.length ?? 0) > 0 && (
          <section className="mb-2">
            <h3 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              {t("stagedChanges")}
            </h3>
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
              repoPath={repoPath ?? ""}
            />
          </section>
        )}

        <section className="mb-2">
          <div className="flex items-center justify-between px-3 py-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              {t("changes")}
            </h3>
            {(status?.unstaged.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() =>
                  void withRepo(async (repo) => {
                    for (const file of status!.unstaged) {
                      await gitStage(repo, file.path);
                    }
                  })
                }
                className="text-[11px] text-accent hover:underline"
              >
                {t("stageAll")}
              </button>
            )}
          </div>
          {(status?.unstaged.length ?? 0) === 0 ? (
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
              repoPath={repoPath ?? ""}
            />
          )}
        </section>

        {history.length > 0 && (
          <section>
            <h3 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              {t("history")}
            </h3>
            <div className="flex gap-1 px-3">
              <HistoryGraphColumn commits={history} />
              <ul className="min-w-0 flex-1">
                {history.map((commit) => (
                  <HistoryRow key={commit.id} commit={commit} />
                ))}
              </ul>
            </div>
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
