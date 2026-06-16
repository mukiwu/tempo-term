import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, Minus, Plus, RefreshCw } from "lucide-react";
import {
  gitCommit,
  gitLog,
  gitResolveRepo,
  gitStage,
  gitStatus,
  gitUnstage,
  type CommitInfo,
  type FileStatus,
  type GitStatus,
} from "./lib/gitBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const STATUS_COLOR: Record<string, string> = {
  M: "text-[--color-warning]",
  A: "text-[--color-success]",
  D: "text-[--color-danger]",
  "?": "text-[--color-fg-subtle]",
  R: "text-[--color-accent]",
};

function StatusRow({
  file,
  actionIcon: ActionIcon,
  actionLabel,
  onAction,
}: {
  file: FileStatus;
  actionIcon: typeof Plus;
  actionLabel: string;
  onAction: (path: string) => void;
}) {
  return (
    <li className="group flex items-center gap-2 px-3 py-1 text-sm hover:bg-[--color-bg-elevated]/60">
      <span
        className={`w-3 shrink-0 text-center font-mono text-xs ${
          STATUS_COLOR[file.status] ?? "text-[--color-fg-muted]"
        }`}
      >
        {file.status}
      </span>
      <span className="flex-1 truncate text-[--color-fg-muted]" title={file.path}>
        {file.path}
      </span>
      <button
        type="button"
        aria-label={actionLabel}
        title={actionLabel}
        onClick={() => onAction(file.path)}
        className="rounded p-0.5 text-[--color-fg-subtle] opacity-0 hover:bg-[--color-border-strong] hover:text-[--color-fg] group-hover:opacity-100"
      >
        <ActionIcon size={14} />
      </button>
    </li>
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

  const refresh = useCallback(async () => {
    if (!repoPath) {
      return;
    }
    try {
      setStatus(await gitStatus(repoPath));
      setHistory(await gitLog(repoPath, 20));
    } catch {
      // ignore transient git errors
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
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[--color-fg-subtle]">
        <GitBranch size={48} strokeWidth={1} />
        <p className="text-sm">{t("noRepo")}</p>
      </div>
    );
  }

  const canCommit = message.trim().length > 0 && (status?.staged.length ?? 0) > 0;

  async function withRepo(fn: (repo: string) => Promise<void>) {
    if (!repoPath) {
      return;
    }
    await fn(repoPath);
    await refresh();
  }

  return (
    <div className="flex h-full flex-col bg-[--color-bg-inset]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[--color-border] px-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-[--color-fg-subtle]">
          {t("title")}
        </span>
        <button
          type="button"
          aria-label={t("refresh")}
          title={t("refresh")}
          onClick={() => void refresh()}
          className="rounded p-1 text-[--color-fg-muted] hover:bg-[--color-bg-elevated] hover:text-[--color-fg]"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {status?.branch && (
        <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-[--color-fg-muted]">
          <GitBranch size={13} className="text-[--color-accent]" />
          {status.branch}
        </div>
      )}

      <div className="px-3 pb-3">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("commitPlaceholder")}
          rows={2}
          className="w-full resize-none rounded-md border border-[--color-border] bg-[--color-bg] px-2 py-1.5 text-sm text-[--color-fg] outline-none focus:border-[--color-accent]"
        />
        <button
          type="button"
          disabled={!canCommit}
          onClick={() =>
            void withRepo(async (repo) => {
              await gitCommit(repo, message);
              setMessage("");
            })
          }
          className="mt-2 w-full rounded-md bg-[--color-accent] px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("commit")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {(status?.staged.length ?? 0) > 0 && (
          <section className="mb-2">
            <h3 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[--color-fg-subtle]">
              {t("stagedChanges")}
            </h3>
            <ul>
              {status!.staged.map((file) => (
                <StatusRow
                  key={`s-${file.path}`}
                  file={file}
                  actionIcon={Minus}
                  actionLabel={t("unstage")}
                  onAction={(path) => void withRepo((repo) => gitUnstage(repo, path))}
                />
              ))}
            </ul>
          </section>
        )}

        <section className="mb-2">
          <div className="flex items-center justify-between px-3 py-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[--color-fg-subtle]">
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
                className="text-[11px] text-[--color-accent] hover:underline"
              >
                {t("stageAll")}
              </button>
            )}
          </div>
          {(status?.unstaged.length ?? 0) === 0 ? (
            <p className="px-3 py-1 text-xs text-[--color-fg-subtle]">{t("noChanges")}</p>
          ) : (
            <ul>
              {status!.unstaged.map((file) => (
                <StatusRow
                  key={`u-${file.path}`}
                  file={file}
                  actionIcon={Plus}
                  actionLabel={t("stage")}
                  onAction={(path) => void withRepo((repo) => gitStage(repo, path))}
                />
              ))}
            </ul>
          )}
        </section>

        {history.length > 0 && (
          <section>
            <h3 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[--color-fg-subtle]">
              {t("history")}
            </h3>
            <ul className="px-3">
              {history.map((commit) => (
                <li key={commit.id} className="py-1 text-xs">
                  <span className="font-mono text-[--color-fg-subtle]">{commit.id}</span>
                  <span className="ml-2 text-[--color-fg-muted]">{commit.summary}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
