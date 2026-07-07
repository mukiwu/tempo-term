import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { onSessionsUpdated } from "./lib/sessionsBridge";
import { sessionsStats, type SessionsStats, type TopSession } from "./lib/statsBridge";
import { useSessionsStore } from "./lib/sessionsStore";
import { AGENT_BADGE_CLASS } from "./lib/agentBadge";
import { heatmapMonthLabels, heatmapWeeks } from "./lib/heatmap";
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
    output_tokens: 0,
  },
  heatmap: [],
  top_by_messages: [],
  top_by_tokens: [],
  weekly: [],
  range_models: [],
};

/** Sample messages/day at the midpoint of each intensity bucket, so the
 *  legend swatches use the exact same class function the cells do. */
const LEGEND_SAMPLES = [0, 2, 6, 15, 30];

/** Intensity bucket for a heatmap cell: 0 / 1-3 / 4-9 / 10-24 / 25+, the same
 *  buckets GitHub's own contribution graph uses. An empty (zero) day still
 *  gets a visible tile so the grid reads as a continuous calendar, not
 *  scattered dots. */
function heatmapBucketClass(messages: number): string {
  if (messages <= 0) return "bg-border";
  if (messages <= 3) return "bg-accent/30";
  if (messages <= 9) return "bg-accent/50";
  if (messages <= 24) return "bg-accent/75";
  return "bg-accent";
}

/** Compact token count: 1.2M / 340K / 512. Keeps big output-token totals
 *  readable on a small tile instead of a 7-digit run. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** A summary tile: a big value, a label, and an optional muted hint that
 *  explains what the number actually means (the labels alone were too terse
 *  to read). */
function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2">
      <div className="text-lg font-semibold text-fg">{value}</div>
      <div className="text-xs text-fg-subtle">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-fg-subtle/70">{hint}</div>}
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
  const { t, i18n } = useTranslation();
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
    sessionsStats(range)
      .then((next) => {
        if (!cancelled) {
          setStats(next);
        }
      })
      // The command is designed never to reject; a rejection would only be a
      // spawn_blocking panic. Swallow it rather than leave the last-good
      // stats on screen behind an unhandled-rejection console error.
      .catch(() => {});
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
  const monthLabels = useMemo(() => heatmapMonthLabels(weeks), [weeks]);
  const rangeCost = useMemo(() => estimateOutputCost(stats.range_models), [stats.range_models]);
  const topSessions = topTab === "messages" ? stats.top_by_messages : stats.top_by_tokens;

  // Localized short month names (Jan / 1月) for the heatmap month strip,
  // formatted through the browser's Intl so no per-month i18n keys are needed.
  const locale = i18n?.language;
  const monthNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: "short" });
    return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(2000, m, 1)));
  }, [locale]);
  // Short weekday names for rows Mon/Wed/Fri (1/3/5) down the heatmap's left edge.
  const weekdayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
    // 2026-03-01 is a Sunday, so +row lands on that weekday.
    return Array.from({ length: 7 }, (_, row) => fmt.format(new Date(2026, 2, 1 + row)));
  }, [locale]);

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

      <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
        <StatCard
          label={t("sessions.dashboard.cards.sessions")}
          value={stats.cards.sessions.toLocaleString()}
        />
        <StatCard
          label={t("sessions.dashboard.cards.messages")}
          value={stats.cards.messages.toLocaleString()}
          hint={t("sessions.dashboard.cards.messagesHint", {
            count: stats.cards.user_messages,
          })}
        />
        <StatCard
          label={t("sessions.dashboard.cards.projects")}
          value={stats.cards.projects.toLocaleString()}
        />
        <StatCard
          label={t("sessions.dashboard.cards.activeDays")}
          value={stats.cards.active_days.toLocaleString()}
        />
        <StatCard
          label={t("sessions.dashboard.cards.mps")}
          value={stats.cards.messages_per_session.toFixed(1)}
          hint={t("sessions.dashboard.cards.mpsHint")}
        />
        <StatCard
          label={t("sessions.dashboard.cards.outputTokens")}
          value={formatTokens(stats.cards.output_tokens)}
          hint={t("sessions.dashboard.cards.outputTokensHint")}
        />
        <StatCard
          label={t("sessions.dashboard.cards.cost")}
          value={`≈ $${rangeCost.usd.toFixed(2)}${rangeCost.unpricedTokens > 0 ? "+" : ""}`}
          hint={t("sessions.dashboard.cards.costHint")}
        />
      </div>

      <div className="mt-4 rounded-md border border-border bg-bg p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase text-fg-subtle">
            {t("sessions.dashboard.heatmapTitle")}
          </h2>
          {/* Legend: what the tile shades mean, less → more. */}
          <div className="flex items-center gap-1 text-[10px] text-fg-subtle">
            <span>{t("sessions.dashboard.legendLess")}</span>
            {LEGEND_SAMPLES.map((sample) => (
              <span
                key={sample}
                className={`h-[10px] w-[10px] rounded-[2px] ${heatmapBucketClass(sample)}`}
              />
            ))}
            <span>{t("sessions.dashboard.legendMore")}</span>
          </div>
        </div>

        <div className="mt-2 overflow-x-auto">
          <div className="inline-block">
            {/* Month strip, aligned to the week columns below it. */}
            <div className="ml-8 flex gap-[3px] text-[10px] text-fg-subtle">
              {monthLabels.map((month, weekIndex) => (
                <span key={weekIndex} className="w-[10px] shrink-0 whitespace-nowrap">
                  {month !== null ? monthNames[month] : ""}
                </span>
              ))}
            </div>

            <div className="flex">
              {/* Weekday labels down the left edge (Mon / Wed / Fri). */}
              <div
                className="mr-1 grid w-7 shrink-0 text-right text-[10px] text-fg-subtle"
                style={{ gridTemplateRows: "repeat(7, 10px)", rowGap: "3px" }}
              >
                {weekdayNames.map((name, row) => (
                  <span key={row} className="leading-[10px]">
                    {row % 2 === 1 ? name : ""}
                  </span>
                ))}
              </div>

              <div
                className="grid grid-flow-col gap-[3px]"
                style={{ gridTemplateRows: "repeat(7, 10px)" }}
              >
                {weeks.map((week, weekIndex) =>
                  week.map((day, dayIndex) => (
                    <div
                      key={`${weekIndex}-${dayIndex}`}
                      title={
                        day
                          ? t("sessions.dashboard.heatmapTooltip", {
                              date: day.date,
                              count: day.messages,
                            })
                          : undefined
                      }
                      className={`h-[10px] w-[10px] rounded-[2px] ${
                        day ? heatmapBucketClass(day.messages) : "bg-transparent"
                      }`}
                    />
                  )),
                )}
              </div>
            </div>
          </div>
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
          {stats.weekly.length === 0 ? (
            <p className="mt-3 text-xs text-fg-subtle">{t("sessions.dashboard.weeklyEmpty")}</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase text-fg-subtle/70">
                  <th className="pb-1 text-left font-medium">
                    {t("sessions.dashboard.weeklyAgent")}
                  </th>
                  <th className="pb-1 text-right font-medium">
                    {t("sessions.dashboard.weeklySessions")}
                  </th>
                  <th className="pb-1 text-right font-medium">
                    {t("sessions.dashboard.weeklyMessages")}
                  </th>
                  <th className="pb-1 text-right font-medium">
                    {t("sessions.dashboard.weeklyTokens")}
                  </th>
                  <th className="pb-1 text-right font-medium">
                    {t("sessions.dashboard.weeklyCost")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.weekly.map((row) => {
                  const costInfo = estimateOutputCost(row.models);
                  // Any tokens this week → show the estimate; a fully unpriced
                  // week still reads as the "≈ $0.00+" floor.
                  const hasCost = costInfo.usd > 0 || costInfo.unpricedTokens > 0;
                  const costStr = `≈ $${costInfo.usd.toFixed(2)}${
                    costInfo.unpricedTokens > 0 ? "+" : ""
                  }`;

                  return (
                    <tr key={row.agent} className="text-fg">
                      <td className={`py-0.5 text-xs font-medium uppercase ${AGENT_BADGE_CLASS[row.agent]}`}>
                        {t(`sessions.agents.${row.agent}`)}
                      </td>
                      <td className="py-0.5 text-right tabular-nums">{row.sessions.toLocaleString()}</td>
                      <td className="py-0.5 text-right tabular-nums">{row.messages.toLocaleString()}</td>
                      <td className="py-0.5 text-right tabular-nums text-fg-subtle">
                        {formatTokens(row.output_tokens)}
                      </td>
                      <td className="py-0.5 text-right tabular-nums text-fg-subtle">
                        {hasCost ? costStr : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-[11px] text-fg-subtle">{t("sessions.dashboard.costNote")}</p>
        </div>
      </div>
    </div>
  );
}
