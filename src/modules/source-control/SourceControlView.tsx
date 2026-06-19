import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Folder,
  FolderTree,
  GitBranch,
  List,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import {
  gitCommit,
  gitDiff,
  gitLog,
  gitPush,
  gitResolveRepo,
  gitStage,
  gitStatus,
  gitUnstage,
  type CommitInfo,
  type FileStatus,
  type GitStatus,
} from "./lib/gitBridge";
import { groupByFolder } from "./lib/groupByFolder";
import { generateCommitMessage } from "./lib/aiCommit";
import { withMinDuration } from "@/lib/withMinDuration";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChatStore } from "@/modules/ai/store/chatStore";

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
  actionIcon: ActionIcon,
  actionLabel,
  onAction,
}: {
  file: FileStatus;
  displayPath?: string;
  actionIcon: typeof Plus;
  actionLabel: string;
  onAction: (path: string) => void;
}) {
  return (
    <li className="group flex items-center gap-2 px-3 py-1 text-sm hover:bg-bg-elevated/60">
      <span
        className={`w-3 shrink-0 text-center font-mono text-xs ${
          STATUS_COLOR[file.status] ?? "text-fg-muted"
        }`}
      >
        {file.status}
      </span>
      <span className="flex-1 truncate text-fg-muted" title={file.path}>
        {displayPath ?? file.path}
      </span>
      <button
        type="button"
        aria-label={actionLabel}
        title={actionLabel}
        onClick={() => onAction(file.path)}
        className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
      >
        <ActionIcon size={14} />
      </button>
    </li>
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
 * Renders a set of changed files either flat (one row per file, full path) or
 * grouped by folder. In folder mode each folder header carries a button that
 * runs the same action across every file under it (stage / unstage the whole
 * folder), and the rows show just the file name since the folder is the header.
 */
function FileList({
  files,
  viewMode,
  rootFolderLabel,
  actionIcon,
  actionLabel,
  folderActionLabel,
  onFileAction,
  onFolderAction,
}: {
  files: FileStatus[];
  viewMode: ViewMode;
  rootFolderLabel: string;
  actionIcon: typeof Plus;
  actionLabel: string;
  folderActionLabel: string;
  onFileAction: (path: string) => void;
  onFolderAction: (paths: string[]) => void;
}) {
  if (viewMode === "flat") {
    return (
      <ul>
        {files.map((file) => (
          <StatusRow
            key={file.path}
            file={file}
            actionIcon={actionIcon}
            actionLabel={actionLabel}
            onAction={onFileAction}
          />
        ))}
      </ul>
    );
  }

  const FolderActionIcon = actionIcon;
  return (
    <ul>
      {groupByFolder(files).map((group) => {
        const display = group.folder === "" ? rootFolderLabel : group.folder;
        return (
          <li key={group.folder || "(root)"}>
            <div className="group flex items-center gap-2 px-3 py-1 text-sm hover:bg-bg-elevated/60">
              <Folder size={13} className="shrink-0 text-fg-subtle" />
              <span className="flex-1 truncate text-fg-muted" title={display}>
                {display}
              </span>
              <button
                type="button"
                aria-label={`${folderActionLabel}: ${display}`}
                title={`${folderActionLabel}: ${display}`}
                onClick={() => onFolderAction(group.files.map((f) => f.path))}
                className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
              >
                <FolderActionIcon size={14} />
              </button>
            </div>
            <ul className="pl-3">
              {group.files.map((file) => (
                <StatusRow
                  key={file.path}
                  file={file}
                  displayPath={basename(file.path)}
                  actionIcon={actionIcon}
                  actionLabel={actionLabel}
                  onAction={onFileAction}
                />
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

export function SourceControlView() {
  const { t } = useTranslation("sourceControl");
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
          <button
            type="button"
            aria-label={viewMode === "flat" ? t("viewFolder") : t("viewFlat")}
            title={viewMode === "flat" ? t("viewFolder") : t("viewFlat")}
            onClick={() => setViewMode((m) => (m === "flat" ? "folder" : "flat"))}
            className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            {viewMode === "flat" ? <FolderTree size={14} /> : <List size={14} />}
          </button>
          <button
            type="button"
            aria-label={t("refresh")}
            title={t("refresh")}
            onClick={() => void refresh()}
            disabled={refreshing}
            className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          </button>
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
          <button
            type="button"
            disabled={!hasStaged || generating}
            onClick={() => void aiGenerate()}
            aria-label={t("aiGenerate")}
            title={t("aiGenerate")}
            className="absolute right-1.5 top-1.5 rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Sparkles size={15} />
            )}
          </button>
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
            title={t("push")}
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
              rootFolderLabel={t("rootFolder")}
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
              rootFolderLabel={t("rootFolder")}
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
            />
          )}
        </section>

        {history.length > 0 && (
          <section>
            <h3 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              {t("history")}
            </h3>
            <ul className="px-3">
              {history.map((commit) => (
                <li key={commit.id} className="py-1 text-xs">
                  <span className="font-mono text-fg-subtle">{commit.id}</span>
                  <span className="ml-2 text-fg-muted">{commit.summary}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
