import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { onSessionsUpdated } from "./lib/sessionsBridge";
import { sessionsStats, type SessionsStats, type TopSession } from "./lib/statsBridge";
import { useSessionsStore } from "./lib/sessionsStore";
import { AGENT_BADGE_CLASS } from "./lib/agentBadge";
import { heatmapWeeks } from "./lib/heatmap";
import { estimateOutputCost } from "./lib/cost";

type RangeDays = 30 | 90 | 365 | null;

const RANGE_OPTIONS: Array<{ key: RangeDays; labelKey: string }> = [
  { key: 30, labelKey: "sessions.dashboard.range30" },
  { key: 90, labelKey: "sessions.dashboard.range90" },
  { key: 365, labelKey: "sessions.dashboard.range365" },
  { key: null, labelKey: "sessions.dashboard.rangeAll" },
];

const EMPTY_STATS: SessionsStats = {
  cards: {
    sessions: 0,
    messages: 0,
    user_messages: 0,
    projects: 0,
    active_days: 0,
    messages_per_session: 0,
  },
  heatmap: [],
  top_by_messages: [],
  top_by_tokens: [],
  weekly: [],
};

/** Intensity bucket for a heatmap cell, per the brief's 0/1-3/4-9/10-24/25+
 *  thresholds — the same buckets GitHub's own contribution graph uses. */
function heatmapBucketClass(messages: number): string {
  if (messages <= 0) return "bg-bg-elevated";
  if (messages <= 3) return "bg-accent/25";
  if (messages <= 9) return "bg-accent/45";
  if (messages <= 24) return "bg-accent/70";
  return "bg-accent";
}

/** One of the five summary tiles at the top of the dashboard. */
function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2">
      <div className="text-lg font-semibold text-fg">{value}</div>
      <div className="text-xs text-fg-subtle">{label}</div>
    </div>
  );
}

interface TopSessionRowProps {
  session: TopSession;
  onSelect: (id: string) => void;
}

function TopSessionRow({ session, onSelect }: TopSessionRowProps) {
  const { t } = useTranslation();
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-bg-elevated"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-sm text-fg">{session.title}</span>
            <span
              className={`shrink-0 text-[10px] font-medium uppercase ${AGENT_BADGE_CLASS[session.agent]}`}
            >
              {t(`sessions.agents.${session.agent}`)}
            </span>
          </div>
          <p className="truncate text-xs text-fg-subtle">{session.project_cwd}</p>
        </div>
        {/* Token counts easily reach 6-7 digits; group them for readability. */}
        <span className="shrink-0 text-xs text-fg-subtle">{session.value.toLocaleString()}</span>
      </button>
    </li>
  );
}

/**
 * Statistics dashboard shown when no session is selected — replaces the old
 * empty state entirely. Fetches `sessions_stats` on mount, on every
 * `sessions-index:updated` event, and whenever the range chip changes;
 * renders summary cards, a GitHub-style activity heatmap, a top-sessions
 * list (toggle by message/token volume, row click selects the session), and
 * a per-agent weekly digest.
 */
export function DashboardView() {
  const { t } = useTranslation();
  const select = useSessionsStore((s) => s.select);
  const [range, setRange] = useState<RangeDays>(365);
  const [stats, setStats] = useState<SessionsStats>(EMPTY_STATS);
  const [topTab, setTopTab] = useState<"messages" | "tokens">("messages");
  // Bumped by every sessions-index:updated event. The fetch effect depends
  // on it, so index updates refetch with the *current* range without the
  // subscription effect having to close over `range` (which would force a
  // listener teardown/re-subscribe on every range change).
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    // `cancelled` scopes the fetch to the (range, tick) that triggered it:
    // a later change or unmount flips it before a stale response can land.
    let cancelled = false;
    void sessionsStats(range).then((next) => {
      if (!cancelled) {
        setStats(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [range, refreshTick]);

  useEffect(() => {
    // Subscribed once for the component's lifetime. Mirrors the
    // disposed-flag pattern in SessionsPanel.tsx: the listen subscription
    // resolves asynchronously, so an unmount before it lands (fast tab
    // switching) releases the listener the moment it arrives instead of
    // leaking it.
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void onSessionsUpdated(() => setRefreshTick((tick) => tick + 1)).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const weeks = useMemo(() => heatmapWeeks(stats.heatmap, new Date()), [stats.heatmap]);
  const topSessions = topTab === "messages" ? stats.top_by_messages : stats.top_by_tokens;

  return (
    <div className="h-full overflow-y-auto bg-bg-inset p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-fg">{t("sessions.dashboard.title")}</h1>
        <div className="flex items-center gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={String(opt.key)}
              type="button"
              aria-pressed={range === opt.key}
              onClick={() => setRange(opt.key)}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                range === opt.key ? "bg-bg-elevated text-fg" : "text-fg-subtle hover:text-fg"
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-2">
        <StatCard label={t("sessions.dashboard.cards.sessions")} value={stats.cards.sessions} />
        <StatCard label={t("sessions.dashboard.cards.messages")} value={stats.cards.messages} />
        <StatCard label={t("sessions.dashboard.cards.projects")} value={stats.cards.projects} />
        <StatCard label={t("sessions.dashboard.cards.activeDays")} value={stats.cards.active_days} />
        <StatCard
          label={t("sessions.dashboard.cards.mps")}
          value={stats.cards.messages_per_session.toFixed(1)}
        />
      </div>

      <div className="mt-4 rounded-md border border-border bg-bg p-3">
        <h2 className="text-xs font-semibold uppercase text-fg-subtle">
          {t("sessions.dashboard.heatmapTitle")}
        </h2>
        <div
          className="mt-2 grid grid-flow-col gap-[3px] overflow-x-auto"
          style={{ gridTemplateRows: "repeat(7, 10px)" }}
        >
          {weeks.map((week, weekIndex) =>
            week.map((day, dayIndex) => (
              <div
                key={`${weekIndex}-${dayIndex}`}
                title={day ? `${day.date} · ${day.messages} messages` : undefined}
                className={`h-[10px] w-[10px] rounded-sm ${
                  day ? heatmapBucketClass(day.messages) : "bg-transparent"
                }`}
              />
            )),
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border bg-bg p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase text-fg-subtle">
              {t("sessions.dashboard.topTitle")}
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={topTab === "messages"}
                onClick={() => setTopTab("messages")}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  topTab === "messages" ? "bg-bg-elevated text-fg" : "text-fg-subtle hover:text-fg"
                }`}
              >
                {t("sessions.dashboard.topByMessages")}
              </button>
              <button
                type="button"
                aria-pressed={topTab === "tokens"}
                onClick={() => setTopTab("tokens")}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  topTab === "tokens" ? "bg-bg-elevated text-fg" : "text-fg-subtle hover:text-fg"
                }`}
              >
                {t("sessions.dashboard.topByTokens")}
              </button>
            </div>
          </div>
          <ul className="mt-2">
            {topSessions.map((session) => (
              <TopSessionRow key={session.id} session={session} onSelect={select} />
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-border bg-bg p-3">
          <h2 className="text-xs font-semibold uppercase text-fg-subtle">
            {t("sessions.dashboard.weeklyTitle")}
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {stats.weekly.map((row) => {
              const costInfo = estimateOutputCost(row.models);
              const hasCost = costInfo.usd > 0 || costInfo.unpricedTokens > 0;
              const costStr =
                costInfo.usd > 0
                  ? `≈ $${costInfo.usd.toFixed(2)}${costInfo.unpricedTokens > 0 ? "+" : ""}`
                  : "";

              return (
                <li
                  key={row.agent}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className={`text-xs font-medium uppercase ${AGENT_BADGE_CLASS[row.agent]}`}>
                    {t(`sessions.agents.${row.agent}`)}
                  </span>
                  <span className="text-fg-subtle">
                    {row.sessions} · {row.messages} · {row.output_tokens.toLocaleString()}
                  </span>
                  {hasCost && <span className="shrink-0 text-xs text-fg-subtle">{costStr}</span>}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[11px] text-fg-subtle">{t("sessions.dashboard.costNote")}</p>
        </div>
      </div>
    </div>
  );
}
