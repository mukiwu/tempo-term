import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Columns2, FolderOpen, HardDrive, Lock, Trash2 } from "lucide-react";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import { formatBytes } from "@/modules/sysmon/lib/format";
import { useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import type { WorktreeDetail } from "./types";
import { gitWorktreeDirtyCount } from "./lib/worktreesBridge";
import { canSplitInto, findWorktreePane, hasPaneRoom } from "./lib/openWorktree";
import { RemoveWorktreeDialog } from "./RemoveWorktreeDialog";
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
 * One worktree: what branch it holds, whether it has uncommitted work, whether
 * an agent is busy in it right now, and the two ways in — a tab of its own, or
 * a split beside whatever you are already looking at.
 *
 * Removal arrives with its own slice.
 */
export function WorktreeRow({ detail, repoPath }: { detail: WorktreeDetail; repoPath: string }) {
  const { t } = useTranslation("worktrees");
  const [dirty, setDirty] = useState<number | null>(null);
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const statuses = useSessionStatusStore((s) => s.statuses);
  const agents = useSessionStatusStore((s) => s.agents);
  const size = useWorktreesStore((s) => s.sizes[detail.path]);
  const loadSize = useWorktreesStore((s) => s.loadSize);
  const closeWorktrees = useUiStore((s) => s.closeWorktrees);
  const [measuring, setMeasuring] = useState(false);
  const [removing, setRemoving] = useState(false);

  const activity = worktreeSessionStatus(tabs, statuses, agents, detail.path);
  const alreadyOpen = findWorktreePane(tabs, detail.path);
  // A worktree whose directory git can no longer find has nothing to spawn a
  // shell in, and a bare one has no working tree at all.
  const unopenable = detail.prunable || detail.bare;
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  const splitTarget = canSplitInto(activeTab) ? activeTab : null;

  const open = () => {
    const tabsApi = useTabsStore.getState();
    if (alreadyOpen) {
      // Take them to the shell that is already there rather than starting a
      // second one in the same directory — two terminals in one worktree is
      // something to ask for, not something to get by accident.
      tabsApi.setActive(alreadyOpen.tabId);
      tabsApi.setActiveLeaf(alreadyOpen.tabId, alreadyOpen.leafId);
    } else {
      // Seeds the cwd onto the pane, not just the tab: `resolveTerminalCwd`
      // ranks the explorer's root above the tab's own dir, so a tab carrying
      // only `cwd` would spawn its shell wherever the explorer happens to be.
      tabsApi.newTerminalTab(detail.path);
    }
    closeWorktrees();
  };

  const split = () => {
    // Re-read rather than trust this render's snapshot: which tab is active, and
    // how many panes it holds, can both move between paint and click.
    const tabsApi = useTabsStore.getState();
    const target = tabsApi.tabs.find((tab) => tab.id === tabsApi.activeId);
    if (!canSplitInto(target) || !hasPaneRoom(target)) {
      return;
    }
    tabsApi.splitPaneWith(
      target.id,
      target.activeLeafId,
      { kind: "terminal", cwd: detail.path },
      "row",
    );
    closeWorktrees();
  };

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
    <div className="group flex items-center gap-3 border-b border-border px-3 py-2 transition-colors last:border-b-0 hover:bg-bg-inset">
      {/* The row's own body is the way in, so the target is the whole line
          rather than a control the eye has to find first. */}
      <button
        type="button"
        onClick={open}
        disabled={unopenable}
        title={unopenable ? t("row.openStale") : alreadyOpen ? t("row.focusHint") : t("row.openHint")}
        aria-label={`${t("row.open")}: ${detail.branch ?? t("row.detached")}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
      >
        <span className="flex w-3 shrink-0 justify-center">
          {activity.status && (
            <span
              aria-label={t(`agent.${activity.status}`)}
              title={`${t(`agent.${activity.status}`)}${activity.agent ? ` · ${activity.agent}` : ""}`}
              className={`h-2 w-2 rounded-full ${STATUS_DOT[activity.status]}`}
            />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`truncate text-sm ${unopenable ? "text-fg-subtle" : "text-fg"}`}>
              {detail.branch ?? t("row.detached")}
            </span>
            {detail.isMain && (
              <span className="shrink-0 rounded border border-border px-1 text-[10px] uppercase text-fg-subtle">
                {t("row.main")}
              </span>
            )}
            {alreadyOpen && (
              <FolderOpen size={11} className="shrink-0 text-fg-subtle" aria-hidden />
            )}
          </span>
          <span className="block truncate font-mono text-[11px] text-fg-subtle">{detail.path}</span>
        </span>
      </button>

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

        {/* Only offered when there is something to sit beside. Splitting is for
            comparing this worktree against what you already have open. */}
        {splitTarget && !unopenable && (
          <button
            type="button"
            onClick={split}
            disabled={!hasPaneRoom(splitTarget)}
            title={hasPaneRoom(splitTarget) ? t("row.splitHint") : t("row.splitFull")}
            aria-label={`${t("row.split")}: ${detail.branch ?? t("row.detached")}`}
            className="flex items-center gap-1 rounded px-1 text-fg-subtle transition-colors hover:text-fg disabled:opacity-40"
          >
            <Columns2 size={12} />
            {t("row.split")}
          </button>
        )}

        {/* The repo's own working tree is not a worktree anyone added, so there
            is nothing here to remove. */}
        {!detail.isMain && (
          <button
            type="button"
            onClick={() => setRemoving(true)}
            aria-label={`${t("row.remove")}: ${detail.branch ?? t("row.detached")}`}
            className="flex items-center gap-1 rounded px-1 text-fg-subtle transition-colors hover:text-danger"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {removing && (
        <RemoveWorktreeDialog
          repoPath={repoPath}
          detail={detail}
          dirty={dirty}
          onDone={() => setRemoving(false)}
        />
      )}
    </div>
  );
}
