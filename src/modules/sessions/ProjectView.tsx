import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionsStore } from "./lib/sessionsStore";
import { sessionsProjectStats, type ProjectStats } from "./lib/projectBridge";
import { openTerminalAt } from "./lib/openTerminalAt";
import { AGENT_BADGE_CLASS } from "./lib/agentBadge";

const EMPTY: ProjectStats = {
  project_cwd: "",
  sessions: 0,
  messages: 0,
  output_tokens: 0,
  active_days: 0,
  top_model: null,
  first_at: 0,
  last_at: 0,
  recent: [],
};

/** A summary tile: a big value and a label. Mirrors DashboardView's
 *  `StatCard` look (border, big tabular-nums value) for a consistent feel
 *  between the two stats screens. */
interface TileProps {
  label: string;
  value: string;
}

function Tile({ label, value }: TileProps) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-bg px-3.5 py-3">
      <div className="truncate text-[20px] font-bold leading-none tabular-nums text-fg">{value}</div>
      <div className="mt-1 text-[11px] text-fg-subtle">{label}</div>
    </div>
  );
}

/**
 * Main-area screen for a single project's aggregates, reached by clicking a
 * project name in the sidebar or the dashboard's Top Sessions list. Fetches
 * `sessions_project_stats` whenever `selectedProject` changes, shows summary
 * tiles plus the project's recent sessions, and offers a shortcut to open a
 * terminal rooted at the project's cwd. Mutually exclusive with the
 * transcript viewer and the dashboard — see `sessionsStore`'s
 * `selectProject`/`select`.
 */
export function ProjectView() {
  const { t } = useTranslation();
  const cwd = useSessionsStore((s) => s.selectedProject) ?? "";
  const selectProject = useSessionsStore((s) => s.selectProject);
  const select = useSessionsStore((s) => s.select);
  const [stats, setStats] = useState<ProjectStats>(EMPTY);

  useEffect(() => {
    // `cancelled` scopes this fetch to the cwd that triggered it: switching
    // projects (or unmounting) before it resolves must not overwrite state
    // with a stale project's stats.
    let cancelled = false;
    if (!cwd) {
      return;
    }
    sessionsProjectStats(cwd)
      .then((next) => {
        if (!cancelled) {
          setStats(next);
        }
      })
      .catch(() => {
        // The command never rejects in practice; swallow defensively rather
        // than leave an unhandled rejection.
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const name = useMemo(() => cwd.split(/[/\\]/).filter(Boolean).pop() ?? cwd, [cwd]);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => selectProject(null)}
          className="rounded px-2 py-1 text-xs text-fg-subtle hover:bg-bg-elevated hover:text-fg"
        >
          {t("sessions.project.back")}
        </button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-fg">{name}</h1>
        <button
          type="button"
          onClick={() => openTerminalAt(cwd)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-subtle hover:bg-bg-elevated hover:text-fg"
        >
          {t("sessions.project.openTerminal")}
        </button>
      </div>
      <p className="mt-0.5 truncate text-xs text-fg-subtle">{cwd}</p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile label={t("sessions.project.sessions")} value={stats.sessions.toLocaleString()} />
        <Tile label={t("sessions.project.messages")} value={stats.messages.toLocaleString()} />
        <Tile label={t("sessions.project.tokens")} value={stats.output_tokens.toLocaleString()} />
        <Tile label={t("sessions.project.activeDays")} value={stats.active_days.toLocaleString()} />
        <Tile label={t("sessions.project.topModel")} value={stats.top_model ?? "—"} />
      </div>

      <h2 className="mt-6 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sessions.project.recent")}
      </h2>
      <ul className="mt-2">
        {stats.recent.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => select(s.id)}
              className="flex w-full min-w-0 items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-bg-elevated"
            >
              <span className="min-w-0 truncate text-sm text-fg">{s.title}</span>
              <span className={`shrink-0 text-[10px] font-medium uppercase ${AGENT_BADGE_CLASS[s.agent]}`}>
                {t(`sessions.agents.${s.agent}`)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
