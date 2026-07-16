import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, HardDrive, Lock } from "lucide-react";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import { formatBytes } from "@/modules/sysmon/lib/format";
import { useTabsStore } from "@/stores/tabsStore";
import type { WorktreeDetail } from "./types";
import { gitWorktreeDirtyCount } from "./lib/worktreesBridge";
import { useWorktreesStore } from "./lib/worktreesStore";
import { worktreeSessionStatus } from "./lib/worktreeStatus";
import type { SessionStatus } from "@/modules/claude-progress/lib/sessionStatus";

/** Same tokens the workspace card and the dock strip dot use. */
const STATUS_DOT: Record<SessionStatus, string> = {
  active: "bg-accent",
  thinking: "bg-fg-muted",
  "waiting-approval": "bg-danger",
  idle: "bg-warning",
};

/**
 * One worktree: what branch it holds, whether it has uncommitted work, and
 * whether an agent is busy in it right now.
 *
 * Read-only for now — open / split / remove arrive with their own slices.
 */
export function WorktreeRow({ detail }: { detail: WorktreeDetail }) {
  const { t } = useTranslation("worktrees");
  const [dirty, setDirty] = useState<number | null>(null);
  const tabs = useTabsStore((s) => s.tabs);
  const statuses = useSessionStatusStore((s) => s.statuses);
  const agents = useSessionStatusStore((s) => s.agents);
  const size = useWorktreesStore((s) => s.sizes[detail.path]);
  const loadSize = useWorktreesStore((s) => s.loadSize);
  const [measuring, setMeasuring] = useState(false);

  const activity = worktreeSessionStatus(tabs, statuses, agents, detail.path);

  useEffect(() => {
    // A gone directory has nothing to count, and git2 would just error. Clear
    // rather than just skip: a row that goes stale keeps its component instance,
    // and with it whatever count it had already loaded.
    if (detail.prunable || detail.bare) {
      setDirty(null);
      return;
    }
    let cancelled = false;
    gitWorktreeDirtyCount(detail.path)
      .then((count) => {
        if (!cancelled) setDirty(count);
      })
      .catch(() => {
        if (!cancelled) setDirty(null);
      });
    return () => {
      cancelled = true;
    };
  }, [detail.path, detail.prunable, detail.bare]);

  const measure = () => {
    setMeasuring(true);
    void loadSize(detail.path).finally(() => setMeasuring(false));
  };

  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <span className="flex w-3 shrink-0 justify-center">
        {activity.status && (
          <span
            aria-label={t(`agent.${activity.status}`)}
            title={`${t(`agent.${activity.status}`)}${activity.agent ? ` · ${activity.agent}` : ""}`}
            className={`h-2 w-2 rounded-full ${STATUS_DOT[activity.status]}`}
          />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-fg">
            {detail.branch ?? t("row.detached")}
          </span>
          {detail.isMain && (
            <span className="shrink-0 rounded border border-border px-1 text-[10px] uppercase text-fg-subtle">
              {t("row.main")}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[11px] text-fg-subtle">{detail.path}</div>
      </div>

      <div className="flex shrink-0 items-center gap-3 text-[11px] text-fg-muted">
        {detail.locked && (
          <span
            className="flex items-center gap-1 text-warning"
            title={detail.lockReason ? t("row.lockedReason", { reason: detail.lockReason }) : undefined}
          >
            <Lock size={12} />
            {t("row.locked")}
          </span>
        )}
        {detail.prunable && (
          <span className="flex items-center gap-1 text-danger">
            <AlertTriangle size={12} />
            {t("row.stale")}
          </span>
        )}
        {dirty !== null && dirty > 0 && (
          <span className="text-warning">{t("row.dirty", { count: dirty })}</span>
        )}
        {size !== undefined ? (
          <span className="font-mono">{formatBytes(size)}</span>
        ) : (
          // Nothing to measure once the directory is gone, and offering a dead
          // button next to the warning saying so is just noise.
          !detail.prunable && (
            // Measuring walks the whole checkout (node_modules and all), so it
            // only ever happens because someone asked for this row.
            <button
              type="button"
              onClick={measure}
              disabled={measuring}
              className="flex items-center gap-1 rounded px-1 text-fg-subtle transition-colors hover:text-fg disabled:opacity-40"
            >
              <HardDrive size={12} />
              {measuring ? t("row.measuring") : t("row.measure")}
            </button>
          )
        )}
      </div>
    </div>
  );
}
