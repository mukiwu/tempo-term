import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Resizer } from "@/components/Resizer";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { gitCommitDetails, gitCommitFileDiff } from "./lib/gitGraphBridge";
import { parseDiffLines } from "./lib/parseDiff";
import { useVirtualRows } from "./lib/useVirtualRows";
import { DiffView } from "./DiffView";
import { DiffExplain } from "./DiffExplain";
import type { CommitDetails, CommitNode, DiffLine } from "./types";

export interface CommitDetailsLabels {
  author: string;
  date: string;
  changedFiles: string;
  noChanges: string;
  noDiff: string;
  noFileSelected: string;
  close: string;
  diffTab: string;
  aiTab: string;
  aiGenerate: string;
  aiExplaining: string;
  aiRegenerate: string;
  aiNeedKey: string;
  aiEmpty: string;
}

interface CommitDetailsPanelProps {
  repo: string;
  commit: CommitNode;
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unexpected error";
}

export function CommitDetailsPanel({ repo, commit, onClose, labels }: CommitDetailsPanelProps) {
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");
  const [tab, setTab] = useState<"diff" | "ai">("diff");
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem("tempoterm-gitgraph-details-left-width"));
    return Number.isFinite(v) && v > 0 ? v : 280;
  });

  const leftWidthRef = useRef(leftWidth);
  leftWidthRef.current = leftWidth;

  const { i18n } = useTranslation("gitGraph");
  const providerId = useChatStore((s) => s.providerId);
  const model = useChatStore((s) => s.model);

  const persistLeftWidth = useCallback(() => {
    localStorage.setItem(
      "tempoterm-gitgraph-details-left-width",
      String(leftWidthRef.current),
    );
  }, []);

  // Load message + changed files when the commit changes; auto-open first file.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDetails(null);
    setSelectedFile(null);
    setDiffLines([]);
    gitCommitDetails(repo, commit.hash)
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
  }, [repo, commit.hash]);

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
    gitCommitFileDiff(repo, commit.hash, selectedFile)
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
  }, [repo, commit.hash, selectedFile]);

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
    commit.hash,
    { listRef: fileListRef },
  );
  const visibleFiles = files.slice(filesWindow.start, filesWindow.end);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="flex items-center justify-between border-b border-border bg-bg-inset px-3 py-1.5">
        <span className="select-all font-mono text-xs font-semibold text-accent">
          {commit.hash}
        </span>
        <button
          type="button"
          onClick={onClose}
          title={labels.close}
          className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
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
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-fg-subtle">
            <span>
              {labels.author}: {commit.author}
            </span>
            <span>
              {labels.date}: {commit.date}
            </span>
          </div>
          {details && (
            <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-fg">
              {details.message}
            </pre>
          )}
          <div className="mt-2 text-[11px] font-medium text-fg-subtle">
            {labels.changedFiles} ({details?.files.length ?? 0})
          </div>
          {details && files.length === 0 ? (
            <div className="mt-1 text-[11px] text-fg-subtle">{labels.noChanges}</div>
          ) : (
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
                    className={`flex w-full items-center gap-2 rounded px-2 text-left font-mono text-[11px] ${
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
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    tab === "diff"
                      ? "bg-bg-elevated text-fg"
                      : "text-fg-subtle hover:text-fg"
                  }`}
                >
                  {labels.diffTab}
                </button>
                <button
                  type="button"
                  onClick={() => setTab("ai")}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    tab === "ai"
                      ? "bg-bg-elevated text-fg"
                      : "text-fg-subtle hover:text-fg"
                  }`}
                >
                  {labels.aiTab}
                </button>
              </div>
              <div className="min-h-0 flex-1">
                {tab === "diff" ? (
                  <DiffView lines={diffLines} emptyLabel={labels.noDiff} />
                ) : (
                  <DiffExplain
                    key={`${commit.hash}|${selectedFile}`}
                    commitHash={commit.hash}
                    file={selectedFile}
                    diffText={diffText}
                    providerId={providerId}
                    model={model}
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
            <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
              {labels.noFileSelected}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
