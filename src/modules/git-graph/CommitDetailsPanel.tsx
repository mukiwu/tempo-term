import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileDiff,
  FolderTree,
  List,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Resizer } from "@/components/Resizer";
import { Tooltip } from "@/components/Tooltip";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { buildFileTree, type TreeNode } from "@/lib/fileTree";
import { useCollapsedPaths } from "@/lib/useCollapsedPaths";
import { fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { gitDiff, type FileStatus, type GitStatus } from "@/modules/source-control/lib/gitBridge";
import {
  gitCommitDetails,
  gitCommitFileDiff,
  gitCommitRangeFiles,
  gitCommitRangeFileDiff,
} from "./lib/gitGraphBridge";
import { parseDiffLines } from "./lib/parseDiff";
import { splitFileDiffs, untrackedDiffLines } from "./lib/uncommittedDiff";
import { useVirtualRows } from "./lib/useVirtualRows";
import { DiffView } from "./DiffView";
import { DiffExplain } from "./DiffExplain";
import type { CommitDetails, CommitFileChange, DiffLine, GraphSelection } from "./types";

export interface CommitDetailsLabels {
  author: string;
  date: string;
  changedFiles: string;
  noChanges: string;
  noDiff: string;
  noFileSelected: string;
  close: string;
  /** Take this comparison to a tab, where there is room to read it. */
  openInTab: string;
  /** Badge shown next to the header hashes while comparing two commits. */
  compareBadge: string;
  diffTab: string;
  aiTab: string;
  aiGenerate: string;
  aiExplaining: string;
  aiRegenerate: string;
  aiNeedKey: string;
  aiEmpty: string;
  viewFolder: string;
  viewFlat: string;
  /** "Expand {{name}}" / "Collapse {{name}}" — {{name}} is filled by the caller. */
  expandFolder: (name: string) => string;
  collapseFolder: (name: string) => string;
  /** Header title while the working tree is selected — it has no hash to show. */
  uncommittedTitle: string;
  /** Shown in place of the file list when nothing is uncommitted. */
  uncommittedClean: string;
  /** "against {{hash}}" — which commit the uncommitted changes sit on top of. */
  relativeTo: (hash: string) => string;
  stagedTitle: string;
  unstagedTitle: string;
}

interface CommitDetailsPanelProps {
  repo: string;
  selection: GraphSelection;
  onClose: () => void;
  /**
   * Take this comparison somewhere with room. This panel is a few hundred
   * pixels tall with a file list along the left third of them, which is
   * enough to glance at a commit and not enough to read one -- the reason
   * #398 exists. Absent when there is nowhere to send it (no repo).
   */
  onOpenInTab?: () => void;
  labels: CommitDetailsLabels;
  /**
   * The working tree, for the `workspace` selection. Passed in rather than
   * fetched here so the row in the graph and this list can never disagree
   * about how many files are staged — they read the same fetch.
   */
  uncommitted?: GitStatus | null;
  /** Short hash of HEAD, for the "against <hash>" subtitle. */
  headHash?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  A: "text-success",
  M: "text-warning",
  D: "text-danger",
  R: "text-accent",
  C: "text-accent",
  T: "text-fg-muted",
};

// Shared empty list so the working-tree arrays keep a stable identity when
// there is nothing to show; they are effect dependencies.
const NO_FILES: FileStatus[] = [];

// Fixed row height for the changed-files list, so it can be windowed the same
// way as the diff. A commit touching thousands of files would otherwise mount
// thousands of buttons at once.
const FILE_ROW_HEIGHT = 22;
const FILE_OVERSCAN = 20;

type FilesViewMode = "flat" | "folder";

// Remembered per panel, not shared with the Source Control sidebar: the two
// lists live at very different widths, so one preference would fit neither.
const FILES_VIEW_MODE_KEY = "tempoterm-gitgraph-files-view-mode";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unexpected error";
}

/**
 * Recursively renders one level of a read-only changed-files tree: folder
 * rows only expand/collapse (no actions — this is a historical commit's
 * files, not the working tree), file rows select a file to view its diff.
 */
function DetailsTreeRows({
  nodes,
  depth,
  collapsed,
  onToggleCollapse,
  selectedFile,
  onSelectFile,
  labels,
}: {
  nodes: TreeNode<CommitFileChange>[];
  depth: number;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  labels: Pick<CommitDetailsLabels, "expandFolder" | "collapseFolder">;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "file") {
          return (
            <button
              key={node.path}
              type="button"
              onClick={() => onSelectFile(node.file.path)}
              style={{ height: `${FILE_ROW_HEIGHT}px`, paddingLeft: `${depth * 14 + 8}px` }}
              className={`flex w-full items-center gap-2 rounded pr-2 text-left font-mono text-[13px] ${
                selectedFile === node.file.path
                  ? "bg-bg-elevated text-fg"
                  : "text-fg-muted hover:bg-bg-elevated/50"
              }`}
            >
              <span
                className={`w-3 shrink-0 font-semibold ${STATUS_COLORS[node.file.status] ?? "text-fg-muted"}`}
              >
                {node.file.status}
              </span>
              <span className="truncate">{node.name}</span>
            </button>
          );
        }
        const isCollapsed = collapsed.has(node.path);
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => onToggleCollapse(node.path)}
              aria-label={
                isCollapsed ? labels.expandFolder(node.path) : labels.collapseFolder(node.path)
              }
              style={{ height: `${FILE_ROW_HEIGHT}px`, paddingLeft: `${depth * 14 + 8}px` }}
              className="flex w-full items-center gap-1 pr-2 text-left font-mono text-[13px] text-fg-subtle hover:bg-bg-elevated/50"
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span className="truncate">{node.name}</span>
            </button>
            {!isCollapsed && (
              <DetailsTreeRows
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                labels={labels}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * One labelled group of working-tree files (staged, or unstaged).
 *
 * Deliberately not windowed like the commit path above it. That list is
 * windowed because a single commit can touch thousands of files; a working tree
 * holding thousands of uncommitted files is a different situation entirely, and
 * the Source Control sidebar renders the same data unwindowed. Sharing the
 * commit path's `useVirtualRows` would have meant one window spanning two
 * lists, which it is not built for.
 */
function WorkspaceFilesGroup({
  title,
  side,
  files,
  viewMode,
  collapsed,
  onToggleCollapse,
  selectedFile,
  selectedStaged,
  onSelectFile,
  labels,
}: {
  title: string;
  /** Which side this group is: true for staged, false for unstaged. */
  side: boolean;
  files: FileStatus[];
  viewMode: FilesViewMode;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  selectedFile: string | null;
  selectedStaged: boolean | null;
  onSelectFile: (file: FileStatus) => void;
  labels: Pick<CommitDetailsLabels, "expandFolder" | "collapseFolder">;
}) {
  if (files.length === 0) {
    return null;
  }
  // A path can sit in both groups at once — staged, then edited again — so the
  // selected row is identified by its side as well as its path.
  const isSelectedSide = selectedStaged === side;
  const isPicked = (file: FileStatus): boolean =>
    isSelectedSide && selectedFile === file.path;
  return (
    <div className="mt-2">
      <div className="text-[13px] font-medium text-fg-subtle">
        {title} ({files.length})
      </div>
      {viewMode === "flat" ? (
        <div className="mt-0.5">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => onSelectFile(f)}
              style={{ height: `${FILE_ROW_HEIGHT}px` }}
              className={`flex w-full items-center gap-2 rounded px-2 text-left font-mono text-[13px] ${
                isPicked(f) ? "bg-bg-elevated text-fg" : "text-fg-muted hover:bg-bg-elevated/50"
              }`}
            >
              <span
                className={`w-3 shrink-0 font-semibold ${STATUS_COLORS[f.status] ?? "text-fg-muted"}`}
              >
                {f.status}
              </span>
              <span className="truncate">{f.path}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-0.5">
          <DetailsTreeRows
            nodes={buildFileTree(files)}
            depth={0}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            selectedFile={isSelectedSide ? selectedFile : null}
            onSelectFile={(path) => {
              const picked = files.find((f) => f.path === path);
              if (picked) {
                onSelectFile(picked);
              }
            }}
            labels={labels}
          />
        </div>
      )}
    </div>
  );
}

export function CommitDetailsPanel({
  repo,
  selection,
  onClose,
  onOpenInTab,
  labels,
  uncommitted,
  headHash,
}: CommitDetailsPanelProps) {
  const isCompare = selection.mode === "compare";
  const isWorkspace = selection.mode === "workspace";
  // Non-null only in single mode; used for the author/date/message block and
  // the AI-explain tab, both of which only make sense for one commit.
  const singleCommit = selection.mode === "single" ? selection.commit : null;
  const rangeKey =
    selection.mode === "single"
      ? selection.commit.hash
      : selection.mode === "compare"
        ? `${selection.from.hash}..${selection.to.hash}`
        : "workspace";
  // The working tree has no hash of its own, so its header carries a title and
  // says which commit it sits on top of instead.
  const headerHash =
    selection.mode === "single"
      ? selection.commit.hash
      : selection.mode === "compare"
        ? `${selection.from.hash} .. ${selection.to.hash}`
        : labels.uncommittedTitle;
  // Memoized, and falling back to a shared constant rather than a fresh []:
  // both arrays are effect dependencies below, and a new identity per render
  // would re-run the diff loader every render — which sets state, which
  // renders again.
  const stagedFiles = useMemo(
    () => (isWorkspace ? (uncommitted?.staged ?? NO_FILES) : NO_FILES),
    [isWorkspace, uncommitted],
  );
  const unstagedFiles = useMemo(
    () => (isWorkspace ? (uncommitted?.unstaged ?? NO_FILES) : NO_FILES),
    [isWorkspace, uncommitted],
  );
  // One `git diff` per side per status, not per file. The panel renders one
  // file's section out of a whole-side answer, so reading it per click meant a
  // subprocess and a full re-scan of the diff for every row the reader touched
  // — the cost of both grows with the repository, not with the file.
  //
  // `uncommitted` is a fresh object on every reload, so its identity is the
  // generation: a status refresh invalidates this without needing a counter.
  // Checked where it is read rather than cleared from an effect, so it cannot
  // depend on the order two effects happen to be declared in.
  const sideDiffs = useRef<{
    repo: string;
    status: GitStatus | null | undefined;
    sides: Map<boolean, Promise<Map<string, string>>>;
  }>({ repo: "", status: undefined, sides: new Map() });

  const readSideDiff = useCallback(
    (staged: boolean): Promise<Map<string, string>> => {
      const cache = sideDiffs.current;
      if (cache.repo !== repo || cache.status !== uncommitted) {
        sideDiffs.current = { repo, status: uncommitted, sides: new Map() };
      }
      const { sides } = sideDiffs.current;
      const cached = sides.get(staged);
      if (cached) {
        return cached;
      }
      // The promise itself is cached, not its result, so clicks that land while
      // one is still in flight join it instead of starting another.
      const pending = gitDiff(repo, staged)
        .then(splitFileDiffs)
        .catch((e: unknown) => {
          // A failure must not outlive its reload: cached, it would leave the
          // panel empty until the next refresh for one transient error.
          sides.delete(staged);
          throw e;
        });
      sides.set(staged, pending);
      return pending;
    },
    [repo, uncommitted],
  );

  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  // Which side of the working tree `selectedFile` was picked from; null outside
  // workspace mode, where a path identifies a file on its own.
  const [selectedStaged, setSelectedStaged] = useState<boolean | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");
  const [tab, setTab] = useState<"diff" | "ai">("diff");
  // `tab` is state, so it can still read "ai" on the render where `selection`
  // just flipped to compare or workspace mode (the effect that resets it to
  // "diff" hasn't run yet). Fall back to "diff" here so the content below never
  // tries to render the AI tab (and dereference `singleCommit`) without one.
  const activeTab = isCompare || isWorkspace ? "diff" : tab;
  const [filesViewMode, setFilesViewMode] = useState<FilesViewMode>(() =>
    localStorage.getItem(FILES_VIEW_MODE_KEY) === "folder" ? "folder" : "flat",
  );
  useEffect(() => {
    localStorage.setItem(FILES_VIEW_MODE_KEY, filesViewMode);
  }, [filesViewMode]);
  const {
    collapsed: collapsedFolders,
    toggle: toggleDetailsFolder,
    reset: resetCollapsedFolders,
  } = useCollapsedPaths();
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem("tempoterm-gitgraph-details-left-width"));
    return Number.isFinite(v) && v > 0 ? v : 280;
  });

  const leftWidthRef = useRef(leftWidth);
  leftWidthRef.current = leftWidth;

  const { i18n } = useTranslation("gitGraph");
  const providerId = useChatStore((s) => s.providerId);
  const model = useChatStore((s) => s.model);
  const customBaseUrl = useChatStore((s) => s.customBaseUrl);

  const persistLeftWidth = useCallback(() => {
    localStorage.setItem(
      "tempoterm-gitgraph-details-left-width",
      String(leftWidthRef.current),
    );
  }, []);

  // Load message + changed files when the selection changes; auto-open first
  // file. Compare mode has no single message, so `details.message` stays "".
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDetails(null);
    setSelectedFile(null);
    setSelectedStaged(null);
    setDiffLines([]);
    resetCollapsedFolders();
    if (selection.mode === "workspace") {
      // The working tree's files arrive as a prop, already fetched for the row
      // in the graph. Nothing to load here.
      return;
    }
    const request =
      selection.mode === "single"
        ? gitCommitDetails(repo, selection.commit.hash)
        : gitCommitRangeFiles(repo, selection.from.hash, selection.to.hash).then((files) => ({
            message: "",
            files,
          }));
    request
      .then((d) => {
        if (cancelled) {
          return;
        }
        setDetails(d);
        setSelectedFile(d.files[0]?.path ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(getErrorMessage(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo, selection, resetCollapsedFolders]);

  // Open the first working-tree file once, when there is one and nothing is
  // picked yet. Kept out of the loader effect above so a status refresh does
  // not yank the reader back to the top of the list.
  useEffect(() => {
    if (selection.mode !== "workspace" || selectedFile !== null) {
      return;
    }
    const first = stagedFiles[0] ?? unstagedFiles[0];
    if (first) {
      setSelectedFile(first.path);
      setSelectedStaged(first.staged);
    }
  }, [selection.mode, selectedFile, stagedFiles, unstagedFiles]);

  // Lazily load the selected file's diff (both parsed lines and raw text), and
  // reset to the Diff tab when the file changes.
  useEffect(() => {
    setTab("diff");
    if (!selectedFile) {
      setDiffLines([]);
      setDiffText("");
      return;
    }
    let cancelled = false;
    if (selection.mode === "workspace") {
      const side = selectedStaged === true;
      const status = (side ? stagedFiles : unstagedFiles).find(
        (f) => f.path === selectedFile,
      )?.status;
      // An untracked file is absent from `git diff` entirely, so its content is
      // read straight off disk and rendered as one added hunk.
      const request: Promise<DiffLine[]> =
        status === "?"
          ? fsReadFile(`${repo}/${selectedFile}`).then((contents) =>
              untrackedDiffLines(selectedFile, contents),
            )
          : readSideDiff(side).then((byPath) =>
              parseDiffLines(byPath.get(selectedFile) ?? ""),
            );
      request
        .then((lines) => {
          if (!cancelled) {
            // The AI tab is hidden in workspace mode, so no raw text is needed.
            setDiffText("");
            setDiffLines(lines);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDiffText("");
            setDiffLines([]);
          }
        });
      return () => {
        cancelled = true;
      };
    }
    const request =
      selection.mode === "single"
        ? gitCommitFileDiff(repo, selection.commit.hash, selectedFile)
        : gitCommitRangeFileDiff(repo, selection.from.hash, selection.to.hash, selectedFile);
    request
      .then((diff) => {
        if (!cancelled) {
          setDiffText(diff);
          setDiffLines(parseDiffLines(diff));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDiffText("");
          setDiffLines([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo, selection, selectedFile, selectedStaged, stagedFiles, unstagedFiles, readSideDiff]);

  // Window the changed-files list inside the left column's single scroll
  // container: the metadata/message header scrolls with it, so the list is
  // measured relative to its own offset (fileListRef) rather than the container
  // top. Keeps one scrollbar over the whole column.
  const files = details?.files ?? [];
  const fileListRef = useRef<HTMLDivElement>(null);
  const filesWindow = useVirtualRows(
    files.length,
    FILE_ROW_HEIGHT,
    FILE_OVERSCAN,
    rangeKey,
    { listRef: fileListRef },
  );
  const visibleFiles = files.slice(filesWindow.start, filesWindow.end);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="flex items-center justify-between border-b border-border bg-bg-inset px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-xs font-semibold text-accent ${
              isWorkspace ? "" : "select-all"
            }`}
          >
            {headerHash}
          </span>
          {isWorkspace && headHash && (
            <span className="font-mono text-[11px] text-fg-subtle">
              {labels.relativeTo(headHash)}
            </span>
          )}
          {isCompare && (
            <span className="rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">
              {labels.compareBadge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {onOpenInTab && (
            <Tooltip label={labels.openInTab}>
              <button
                type="button"
                onClick={onOpenInTab}
                aria-label={labels.openInTab}
                className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
              >
                <FileDiff className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
          <Tooltip label={labels.close}>
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          </Tooltip>
        </div>
      </div>

      {error && <div className="px-3 py-1.5 text-xs text-danger" role="alert">{error}</div>}

      <div className="flex min-h-0 flex-1">
        {/* 左欄：metadata + 訊息 + 變更檔案，整欄共用單一卷軸；檔案清單虛擬化 */}
        <div
          ref={filesWindow.scrollRef}
          onScroll={filesWindow.onScroll}
          style={{ width: `${leftWidth}px` }}
          className="relative shrink-0 overflow-auto px-3 py-2"
        >
          {singleCommit && (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[13px] text-fg-subtle">
                <span>
                  {labels.author}: {singleCommit.author}
                </span>
                <span>
                  {labels.date}: {singleCommit.date}
                </span>
              </div>
              {details && (
                <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] text-fg">
                  {details.message}
                </pre>
              )}
            </>
          )}
          <div className="mt-2 flex items-center justify-between text-[13px] font-medium text-fg-subtle">
            <span>
              {isWorkspace
                ? `${labels.changedFiles} (${stagedFiles.length + unstagedFiles.length})`
                : `${labels.changedFiles} (${details?.files.length ?? 0})`}
            </span>
            <Tooltip label={filesViewMode === "flat" ? labels.viewFolder : labels.viewFlat}>
              <button
                type="button"
                aria-label={filesViewMode === "flat" ? labels.viewFolder : labels.viewFlat}
                onClick={() => setFilesViewMode((m) => (m === "flat" ? "folder" : "flat"))}
                className="rounded p-0.5 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
              >
                {filesViewMode === "flat" ? <FolderTree size={13} /> : <List size={13} />}
              </button>
            </Tooltip>
          </div>
          {isWorkspace ? (
            stagedFiles.length + unstagedFiles.length === 0 ? (
              <div className="mt-1 text-[13px] text-fg-subtle">{labels.uncommittedClean}</div>
            ) : (
              <div ref={fileListRef}>
                <WorkspaceFilesGroup
                  title={labels.stagedTitle}
                  side
                  files={stagedFiles}
                  viewMode={filesViewMode}
                  collapsed={collapsedFolders}
                  onToggleCollapse={toggleDetailsFolder}
                  selectedFile={selectedFile}
                  selectedStaged={selectedStaged}
                  onSelectFile={(f) => {
                    setSelectedFile(f.path);
                    setSelectedStaged(f.staged);
                  }}
                  labels={labels}
                />
                <WorkspaceFilesGroup
                  title={labels.unstagedTitle}
                  side={false}
                  files={unstagedFiles}
                  viewMode={filesViewMode}
                  collapsed={collapsedFolders}
                  onToggleCollapse={toggleDetailsFolder}
                  selectedFile={selectedFile}
                  selectedStaged={selectedStaged}
                  onSelectFile={(f) => {
                    setSelectedFile(f.path);
                    setSelectedStaged(f.staged);
                  }}
                  labels={labels}
                />
              </div>
            )
          ) : details && files.length === 0 ? (
            <div className="mt-1 text-[13px] text-fg-subtle">{labels.noChanges}</div>
          ) : filesViewMode === "flat" ? (
            <div
              ref={fileListRef}
              style={{ height: `${filesWindow.totalHeight}px` }}
              className="relative mt-0.5"
            >
              <div style={{ transform: `translateY(${filesWindow.offsetTop}px)` }}>
                {visibleFiles.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => setSelectedFile(f.path)}
                    style={{ height: `${FILE_ROW_HEIGHT}px` }}
                    className={`flex w-full items-center gap-2 rounded px-2 text-left font-mono text-[13px] ${
                      selectedFile === f.path
                        ? "bg-bg-elevated text-fg"
                        : "text-fg-muted hover:bg-bg-elevated/50"
                    }`}
                  >
                    <span
                      className={`w-3 shrink-0 font-semibold ${STATUS_COLORS[f.status] ?? "text-fg-muted"}`}
                    >
                      {f.status}
                    </span>
                    <span className="truncate">{f.path}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div ref={fileListRef} className="relative mt-0.5">
              <DetailsTreeRows
                nodes={buildFileTree(files)}
                depth={0}
                collapsed={collapsedFolders}
                onToggleCollapse={toggleDetailsFolder}
                selectedFile={selectedFile}
                onSelectFile={setSelectedFile}
                labels={labels}
              />
            </div>
          )}
        </div>

        <Resizer
          orientation="vertical"
          onResize={(delta) =>
            setLeftWidth((w) => Math.min(640, Math.max(180, w + delta)))
          }
          onResizeEnd={persistLeftWidth}
        />

        {/* 右欄：分頁 + diff/AI */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedFile ? (
            <>
              <div className="flex shrink-0 items-center gap-1 border-b border-border bg-bg-inset px-2 py-1">
                <button
                  type="button"
                  onClick={() => setTab("diff")}
                  className={`rounded px-2 py-0.5 text-[13px] ${
                    tab === "diff"
                      ? "bg-bg-elevated text-fg"
                      : "text-fg-subtle hover:text-fg"
                  }`}
                >
                  {labels.diffTab}
                </button>
                {!isCompare && !isWorkspace && (
                  <button
                    type="button"
                    onClick={() => setTab("ai")}
                    className={`rounded px-2 py-0.5 text-[13px] ${
                      tab === "ai"
                        ? "bg-bg-elevated text-fg"
                        : "text-fg-subtle hover:text-fg"
                    }`}
                  >
                    {labels.aiTab}
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1">
                {activeTab === "diff" ? (
                  <DiffView lines={diffLines} emptyLabel={labels.noDiff} />
                ) : (
                  <DiffExplain
                    key={`${singleCommit?.hash ?? ""}|${selectedFile}`}
                    commitHash={singleCommit?.hash ?? ""}
                    file={selectedFile}
                    diffText={diffText}
                    providerId={providerId}
                    model={model}
                    customBaseUrl={customBaseUrl}
                    lang={i18n.language}
                    labels={{
                      generate: labels.aiGenerate,
                      explaining: labels.aiExplaining,
                      regenerate: labels.aiRegenerate,
                      needKey: labels.aiNeedKey,
                      empty: labels.aiEmpty,
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-fg-subtle">
              {labels.noFileSelected}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
