import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FolderTree, List, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Resizer } from "@/components/Resizer";
import { Tooltip } from "@/components/Tooltip";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { buildFileTree, type TreeNode } from "@/lib/fileTree";
import { useCollapsedPaths } from "@/lib/useCollapsedPaths";
import {
  gitCommitDetails,
  gitCommitFileDiff,
  gitCommitRangeFiles,
  gitCommitRangeFileDiff,
} from "./lib/gitGraphBridge";
import { parseDiffLines } from "./lib/parseDiff";
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
}

interface CommitDetailsPanelProps {
  repo: string;
  selection: GraphSelection;
  onClose: () => void;
  labels: CommitDetailsLabels;
}

const STATUS_COLORS: Record<string, string> = {
  A: "text-success",
  M: "text-warning",
  D: "text-danger",
  R: "text-accent",
  C: "text-accent",
  T: "text-fg-muted",
};

// Fixed row height for the changed-files list, so it can be windowed the same
// way as the diff. A commit touching thousands of files would otherwise mount
// thousands of buttons at once.
const FILE_ROW_HEIGHT = 22;
const FILE_OVERSCAN = 20;

type FilesViewMode = "flat" | "folder";

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

export function CommitDetailsPanel({ repo, selection, onClose, labels }: CommitDetailsPanelProps) {
  const isCompare = selection.mode === "compare";
  // Non-null only in single mode; used for the author/date/message block and
  // the AI-explain tab, both of which only make sense for one commit.
  const singleCommit = selection.mode === "single" ? selection.commit : null;
  const rangeKey =
    selection.mode === "single" ? selection.commit.hash : `${selection.from.hash}..${selection.to.hash}`;
  const headerHash =
    selection.mode === "single" ? selection.commit.hash : `${selection.from.hash} .. ${selection.to.hash}`;
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");
  const [tab, setTab] = useState<"diff" | "ai">("diff");
  // `tab` is state, so it can still read "ai" on the render where `selection`
  // just flipped to compare mode (the effect that resets it to "diff" hasn't
  // run yet). Fall back to "diff" here so the content below never tries to
  // render the AI tab (and dereference `singleCommit`) while isCompare.
  const activeTab = isCompare ? "diff" : tab;
  const [filesViewMode, setFilesViewMode] = useState<FilesViewMode>("flat");
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
    setDiffLines([]);
    resetCollapsedFolders();
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
  }, [repo, selection, selectedFile]);

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
          <span className="select-all font-mono text-xs font-semibold text-accent">
            {headerHash}
          </span>
          {isCompare && (
            <span className="rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">
              {labels.compareBadge}
            </span>
          )}
        </div>
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
              {labels.changedFiles} ({details?.files.length ?? 0})
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
          {details && files.length === 0 ? (
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
                {!isCompare && (
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
