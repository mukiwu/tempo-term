import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitCommit } from "lucide-react";
import {
  gitLog,
  gitResolveRepo,
  type CommitInfo,
} from "@/modules/source-control/lib/gitBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";

function formatTime(seconds: number): string {
  const d = new Date(seconds * 1000);
  return d.toLocaleString();
}

export function GitGraphTabContent() {
  const { t } = useTranslation("gitGraph");
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [resolved, setResolved] = useState(false);
  const [hasRepo, setHasRepo] = useState(false);

  useEffect(() => {
    if (!rootPath) {
      setResolved(true);
      return;
    }
    let cancelled = false;
    gitResolveRepo(rootPath)
      .then(async (repo) => {
        if (cancelled) {
          return;
        }
        if (!repo) {
          setHasRepo(false);
          setResolved(true);
          return;
        }
        setHasRepo(true);
        try {
          setCommits(await gitLog(repo, 200));
        } catch {
          setCommits([]);
        }
        setResolved(true);
      })
      .catch(() => setResolved(true));
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  if (resolved && !hasRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-subtle">
        <GitCommit size={40} strokeWidth={1} />
        <p className="text-sm">{t("noRepo")}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-bg px-4 py-3">
      <ul>
        {commits.map((commit) => (
          <li key={commit.id} className="flex items-start gap-3 py-1.5">
            <div className="flex flex-col items-center pt-1">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-accent" />
              <span className="mt-0.5 w-px flex-1 bg-border" />
            </div>
            <div className="min-w-0 flex-1 border-b border-border/50 pb-2">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm text-fg">{commit.summary}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-fg-subtle">
                  {commit.id}
                </span>
              </div>
              <div className="text-[11px] text-fg-subtle">
                {commit.author} · {formatTime(commit.timestamp)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
