import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { onSessionsUpdated } from "./lib/sessionsBridge";
import {
  sessionsStats,
  type HeatmapMetric,
  type SessionsStats,
  type TopSession,
} from "./lib/statsBridge";
import { Tooltip } from "@/components/Tooltip";
import { useSessionsStore, visibleSessions } from "./lib/sessionsStore";
import { toSessionsCsv } from "./lib/sessionsCsv";
import { saveFile } from "@/lib/dialog";
import { fsWriteFile } from "@/modules/explorer/lib/fsBridge";
import { AGENT_BADGE_CLASS } from "./lib/agentBadge";
import { heatmapLevel, heatmapMax, heatmapMonthLabels, heatmapWeeks } from "./lib/heatmap";
import { estimateOutputCost } from "./lib/cost";
import { formatHour, modelSlices, OTHERS_SLICE, peakHour } from "./lib/insights";

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
  hourly: new Array(24).fill(0),
};

/** Tailwind class per intensity level (0..4). Level 0 is a faint visible tile
 *  so empty days read as a continuous calendar, not scattered dots; 1..4 ramp
 *  the accent up. Levels come from `heatmapLevel`, scaled to the range's max
 *  for whichever metric is shown. */
const HEATMAP_LEVEL_CLASS = ["bg-border", "bg-accent/30", "bg-accent/55", "bg-accent/78", "bg-accent"];

/** The heatmap metrics the user can toggle between, and their card/legend key. */
const HEATMAP_METRICS: Array<{ key: HeatmapMetric; labelKey: string }> = [
  { key: "messages", labelKey: "sessions.dashboard.metricMessages" },
  { key: "sessions", labelKey: "sessions.dashboard.metricSessions" },
  { key: "output_tokens", labelKey: "sessions.dashboard.metricTokens" },
];

/** Compact token count: 1.2M / 340K / 512. Keeps big output-token totals
 *  readable on a small tile instead of a 7-digit run. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Distinct slice colors for the model donut, drawn from the app's theme
 *  hues (teal accent, purple, amber, rose, emerald, muted slate) so the chart
 *  stays on-brand; the last is reserved for the aggregated "others" slice. */
const SLICE_COLORS = ["#5eaab5", "#d9739f", "#e6cc77", "#cb7676", "#4d9375", "#9d9a8e", "#6b6b6b"];

/** A donut of each model's share of output tokens, with a legend. Uses a CSS
 *  conic-gradient ring (no chart library) punched out to a donut by an inner
 *  disc the color of the card. Handles many models via the "others" slice. */
function ModelDonut({ slices, othersLabel }: { slices: ReturnType<typeof modelSlices>; othersLabel: string }) {
  let acc = 0;
  const stops = slices
    .map((s, i) => {
      const start = acc;
      acc += s.pct;
      return `${SLICE_COLORS[i % SLICE_COLORS.length]} ${start}% ${acc}%`;
    })
    .join(", ");

  return (
    <div className="mt-3 flex items-center gap-4">
      <div
        className="relative h-28 w-28 shrink-0 rounded-full"
        style={{ background: `conic-gradient(${stops})` }}
      >
        <div className="absolute inset-[26%] rounded-full bg-bg" />
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-fg-muted">
              {s.label === OTHERS_SLICE ? othersLabel : s.label}
            </span>
            <span className="shrink-0 tabular-nums text-fg-subtle">{s.pct.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A summary tile: a big value, a label, and an optional muted hint that
 *  explains what the number actually means (the labels alone were too terse
 *  to read). */
function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-bg px-3.5 py-3">
      <div
        className={`text-[22px] font-bold leading-none tabular-nums ${accent ? "text-accent" : "text-fg"}`}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] text-fg-subtle">{label}</div>
      {hint && <div className="text-[10px] text-fg-subtle/70">{hint}</div>}
    </div>
  );
}

interface TopSessionRowProps {
  session: TopSession;
  onSelect: (id: string) => void;
  onSelectProject: (cwd: string) => void;
}

function TopSessionRow({ session, onSelect, onSelectProject }: TopSessionRowProps) {
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
          {/* Nested inside the row's own select-session button, so a click
              here must stop propagation or it would also select the session;
              role="button" + a keydown handler keep it reachable from the
              keyboard despite not being a real <button> (which can't nest
              inside another button). An empty cwd has nothing to route to
              (onSelectProject("") would fall through to the dashboard), so
              it's skipped entirely rather than rendered as a no-op link. */}
          {session.project_cwd && (
            <p
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                if (session.project_cwd) {
                  onSelectProject(session.project_cwd);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (session.project_cwd) {
                    onSelectProject(session.project_cwd);
                  }
                }
              }}
              className="truncate text-xs text-fg-subtle hover:text-fg hover:underline"
            >
              {session.project_cwd}
            </p>
          )}
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
  const selectProject = useSessionsStore((s) => s.selectProject);
  const sessions = useSessionsStore((s) => s.sessions);
  const query = useSessionsStore((s) => s.query);
  const agentFilter = useSessionsStore((s) => s.agentFilter);
  const modelFilter = useSessionsStore((s) => s.modelFilter);
  const projectFilter = useSessionsStore((s) => s.projectFilter);
  const [range, setRange] = useState<RangeDays>(365);
  const [stats, setStats] = useState<SessionsStats>(EMPTY_STATS);
  const [topTab, setTopTab] = useState<"messages" | "tokens">("messages");
  const [metric, setMetric] = useState<HeatmapMetric>("messages");
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

  // A fixed range (30/90/365 days) spans the whole window so the heatmap
  // renders a full calendar with empty leading months, GitHub-style; "all
  // time" (range null) lets the grid start at the earliest active day.
  const weeks = useMemo(() => {
    const end = new Date();
    const start = range === null ? undefined : new Date(end.getFullYear(), end.getMonth(), end.getDate() - range);
    return heatmapWeeks(stats.heatmap, end, start);
  }, [stats.heatmap, range]);
  const busiestHour = useMemo(() => peakHour(stats.hourly), [stats.hourly]);
  const hourlyPeak = useMemo(() => Math.max(1, ...stats.hourly), [stats.hourly]);
  const donutSlices = useMemo(() => modelSlices(stats.range_models, 6), [stats.range_models]);
  const monthLabels = useMemo(() => heatmapMonthLabels(weeks), [weeks]);
  const rangeCost = useMemo(() => estimateOutputCost(stats.range_models), [stats.range_models]);
  const heatmapPeak = useMemo(() => heatmapMax(stats.heatmap, metric), [stats.heatmap, metric]);
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

  // Exports exactly the sessions currently visible under the active
  // search/agent/model/project filters (not the full unfiltered index),
  // mirroring what the sessions panel itself shows.
  async function handleExportCsv() {
    const { pinned, history } = visibleSessions(
      sessions,
      query,
      agentFilter,
      modelFilter,
      projectFilter,
    );
    const csv = toSessionsCsv([...pinned, ...history]);
    const path = await saveFile("ai-sessions.csv", [{ name: "CSV", extensions: ["csv"] }]);
    if (path === null) {
      return;
    }
    await fsWriteFile(path, csv);
  }

  return (
    <div className="h-full overflow-y-auto bg-bg-inset p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-fg">{t("sessions.dashboard.title")}</h1>
        <div className="flex items-center gap-3">
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
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-subtle transition-colors hover:text-fg"
          >
            {t("sessions.dashboard.exportCsv")}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StatCard
          label={t("sessions.dashboard.cards.sessions")}
          value={stats.cards.sessions.toLocaleString()}
        />
        <StatCard
          label={t("sessions.dashboard.cards.messages")}
          value={stats.cards.messages.toLocaleString()}
          hint={t("sessions.dashboard.cards.messagesHint", {
            count: stats.cards.user_messages.toLocaleString(),
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
          accent
          label={t("sessions.dashboard.cards.cost")}
          value={`≈ US$ ${rangeCost.usd.toFixed(2)}${rangeCost.unpricedTokens > 0 ? "+" : ""}`}
          hint={t("sessions.dashboard.cards.costHint")}
        />
      </div>

      <div className="mt-3 rounded-lg border border-border bg-bg p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            {t("sessions.dashboard.heatmapTitle")}
          </h2>
          {/* Which metric the tile intensity encodes. */}
          <div className="flex items-center gap-0.5">
            {HEATMAP_METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={metric === m.key}
                onClick={() => setMetric(m.key)}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  metric === m.key ? "bg-bg-elevated text-fg" : "text-fg-subtle hover:text-fg"
                }`}
              >
                {t(m.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 overflow-x-auto pb-1">
          <div className="inline-flex flex-col gap-1.5">
            {/* Month strip, aligned to the week columns below (14px cell + 4px gap). */}
            <div className="ml-[30px] flex text-[10px] text-fg-subtle">
              {monthLabels.map((month, weekIndex) => (
                <span key={weekIndex} className="w-[18px] shrink-0 whitespace-nowrap">
                  {month !== null ? monthNames[month] : ""}
                </span>
              ))}
            </div>

            <div className="flex">
              {/* Weekday labels down the left edge (Mon / Wed / Fri). */}
              <div
                className="mr-1.5 grid w-6 shrink-0 text-right text-[10px] text-fg-subtle"
                style={{ gridTemplateRows: "repeat(7, 14px)", rowGap: "4px" }}
              >
                {weekdayNames.map((name, row) => (
                  <span key={row} className="leading-[14px]">
                    {row % 2 === 1 ? name : ""}
                  </span>
                ))}
              </div>

              <div
                className="grid grid-flow-col gap-1"
                style={{ gridTemplateRows: "repeat(7, 14px)" }}
              >
                {weeks.map((week, weekIndex) =>
                  week.map((day, dayIndex) => {
                    if (!day) {
                      return <div key={`${weekIndex}-${dayIndex}`} className="h-[14px] w-[14px]" />;
                    }
                    // Compute the label once for both the visual tooltip and
                    // the accessible name, rather than calling t() twice per cell.
                    const label = t("sessions.dashboard.heatmapTooltip", {
                      date: day.date,
                      count: day[metric],
                    });
                    return (
                      <Tooltip
                        key={`${weekIndex}-${dayIndex}`}
                        delayMs={60}
                        label={label}
                        className="h-[14px] w-[14px]"
                      >
                        <div
                          aria-label={label}
                          className={`h-[14px] w-[14px] rounded-[3px] ${
                            HEATMAP_LEVEL_CLASS[heatmapLevel(day[metric], heatmapPeak)]
                          }`}
                        />
                      </Tooltip>
                    );
                  }),
                )}
              </div>
            </div>

            {/* Legend: what the tile shades mean, less → more. */}
            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-fg-subtle">
              <span>{t("sessions.dashboard.legendLess")}</span>
              {HEATMAP_LEVEL_CLASS.map((cls, i) => (
                <span key={i} className={`h-[12px] w-[12px] rounded-[3px] ${cls}`} />
              ))}
              <span>{t("sessions.dashboard.legendMore")}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Left: top sessions. */}
        <div className="rounded-lg border border-border bg-bg p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
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
              <TopSessionRow
                key={session.id}
                session={session}
                onSelect={select}
                onSelectProject={selectProject}
              />
            ))}
          </ul>
        </div>

        {/* Right: hour-of-day activity, model usage donut, and the weekly table, stacked. */}
        <div className="flex flex-col gap-3">
          {/* Activity by hour of day (local). Peak hour emphasized. */}
          <div className="rounded-lg border border-border bg-bg p-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              {t("sessions.dashboard.hourlyTitle")}
            </h2>
            <div className="mt-3 flex h-20 items-end gap-[2px]">
              {stats.hourly.map((count, hour) => (
                <Tooltip
                  key={hour}
                  delayMs={60}
                  label={t("sessions.dashboard.hourlyTooltip", { hour: formatHour(hour), count })}
                  className="flex-1 items-end"
                >
                  <div
                    className={`w-full rounded-sm ${hour === busiestHour ? "bg-accent" : "bg-accent/35"}`}
                    style={{ height: `${Math.max(2, (count / hourlyPeak) * 80)}px` }}
                  />
                </Tooltip>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-fg-subtle">
              <span>0h</span>
              <span>6h</span>
              <span>12h</span>
              <span>18h</span>
              <span>23h</span>
            </div>
          </div>

          {/* Model usage as a share donut (readable even with many models). */}
          <div className="rounded-lg border border-border bg-bg p-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              {t("sessions.dashboard.modelsTitle")}
            </h2>
            {donutSlices.length === 0 ? (
              <p className="mt-3 text-xs text-fg-subtle">{t("sessions.dashboard.modelsEmpty")}</p>
            ) : (
              <ModelDonut slices={donutSlices} othersLabel={t("sessions.dashboard.modelsOthers")} />
            )}
          </div>

          {/* This week's per-agent breakdown. */}
          <div className="rounded-lg border border-border bg-bg p-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              {t("sessions.dashboard.weeklyTitle")}
            </h2>
            {stats.weekly.length === 0 ? (
              <p className="mt-3 text-xs text-fg-subtle">{t("sessions.dashboard.weeklyEmpty")}</p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase text-fg-subtle/70">
                    <th className="pb-1 text-left font-medium">{t("sessions.dashboard.weeklyAgent")}</th>
                    <th className="pb-1 text-right font-medium">{t("sessions.dashboard.weeklySessions")}</th>
                    <th className="pb-1 text-right font-medium">{t("sessions.dashboard.weeklyMessages")}</th>
                    <th className="pb-1 text-right font-medium">{t("sessions.dashboard.weeklyTokens")}</th>
                    <th className="pb-1 text-right font-medium">
                      <span className="inline-flex items-center gap-1">
                        {t("sessions.dashboard.weeklyCost")}
                        <span className="rounded border border-border-strong px-1 text-[8px] normal-case text-fg-subtle">
                          USD
                        </span>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.weekly.map((row) => {
                    const costInfo = estimateOutputCost(row.models);
                    // Any tokens this week → show the estimate; a fully unpriced
                    // week still reads as the "≈ $0.00+" floor.
                    const hasCost = costInfo.usd > 0 || costInfo.unpricedTokens > 0;
                    const costStr = `≈ $${costInfo.usd.toFixed(2)}${costInfo.unpricedTokens > 0 ? "+" : ""}`;

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
            <p className="mt-2 text-[11px] text-fg-subtle">{t("sessions.dashboard.costNote")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
