import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { cacheHitRate, estimateCost, totalTokens } from "./lib/cost";
import {
  dailyUsage,
  formatHour,
  modelSlices,
  OTHERS_SLICE,
  peakHour,
  sessionsActiveOn,
} from "./lib/insights";

type RangeDays = 0 | 7 | 30 | 90 | 365 | null;

const RANGE_OPTIONS: Array<{ key: RangeDays; labelKey: string }> = [
  { key: 0, labelKey: "sessions.dashboard.rangeToday" },
  { key: 7, labelKey: "sessions.dashboard.range7" },
  { key: 30, labelKey: "sessions.dashboard.range30" },
  { key: 90, labelKey: "sessions.dashboard.range90" },
  { key: 365, labelKey: "sessions.dashboard.range365" },
  { key: null, labelKey: "sessions.dashboard.rangeAll" },
];

/** The heatmap always spans at least this many days (the backend sends a
 *  year of history regardless of the range), so short ranges still render a
 *  full calendar. */
const HEATMAP_DAYS = 365;

const EMPTY_STATS: SessionsStats = {
  cards: {
    sessions: 0,
    messages: 0,
    user_messages: 0,
    projects: 0,
    active_days: 0,
    messages_per_session: 0,
    output_tokens: 0,
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    tool_calls: 0,
  },
  heatmap: [],
  top_by_messages: [],
  top_by_tokens: [],
  weekly: [],
  range_models: [],
  hourly: new Array(24).fill(0),
  daily_models: [],
  top_tools: [],
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
  { key: "tokens", labelKey: "sessions.dashboard.metricTokens" },
];

/** One color per token kind, shared by the composition bar, the 7-day chart
 *  and their legends so the same kind reads the same everywhere. */
const TOKEN_KINDS = [
  { key: "cacheRead", labelKey: "sessions.dashboard.tokenKinds.cacheRead", color: "var(--color-cyan-500)" },
  { key: "cacheWrite", labelKey: "sessions.dashboard.tokenKinds.cacheWrite", color: "var(--color-amber-400)" },
  { key: "input", labelKey: "sessions.dashboard.tokenKinds.input", color: "var(--color-purple-500)" },
  { key: "output", labelKey: "sessions.dashboard.tokenKinds.output", color: "var(--color-emerald-500)" },
] as const;

type TokenKind = (typeof TOKEN_KINDS)[number]["key"];

/** Compact token count: 1.2M / 340K / 512. Keeps big token totals readable
 *  on a small tile instead of a 7-digit run. */
function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatUsd(cost: { usd: number; unpricedTokens: number }): string {
  return `≈ US$ ${cost.usd.toFixed(2)}${cost.unpricedTokens > 0 ? "+" : ""}`;
}

/** Distinct slice colors for the model donut, drawn from the app's theme
 *  hues (teal accent, purple, amber, rose, emerald, muted slate) so the chart
 *  stays on-brand; the last is reserved for the aggregated "others" slice. */
const SLICE_COLORS = ["#5eaab5", "#d9739f", "#e6cc77", "#cb7676", "#4d9375", "#9d9a8e", "#6b6b6b"];

/** Shared card surface. Cards sit on the inset page background with a
 *  hairline border, matching the rest of the sessions module. */
function Card({ title, action, className = "", children }: {
  title?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-xl border border-border bg-bg p-4 ${className}`}>
      {(title || action) && (
        <div className="flex min-h-6 items-center justify-between gap-2">
          {title && <h2 className="text-xs font-semibold text-fg">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** A compact segmented control. Inner buttons use a radius 2px smaller than
 *  the 2px-padded track so the corners stay concentric. */
function Segmented<T extends string | number | null>({ options, value, onChange }: {
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex shrink-0 items-center rounded-md bg-bg-elevated p-0.5">
      {options.map((opt) => (
        <button
          key={String(opt.key)}
          type="button"
          aria-pressed={value === opt.key}
          onClick={() => onChange(opt.key)}
          className={`rounded px-2 py-0.5 text-[11px] transition-[color,background-color,scale] active:scale-[0.96] ${
            value === opt.key ? "bg-bg text-fg shadow-sm" : "text-fg-subtle hover:text-fg"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Single-line text that truncates with an ellipsis and, only when it is
 *  actually cut off, shows the full text in a tooltip on hover. Overflow is
 *  measured up front and on every resize, so the tooltip is ready on the
 *  first hover. */
function TruncatedText({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollWidth > el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return (
    // Layout and text classes go on the wrapper (the flex item); the inner
    // block only truncates and inherits font, size and color from it.
    <Tooltip delayMs={150} label={clipped && text} className={`min-w-0 ${className}`}>
      <div ref={ref} className="min-w-0 flex-1 truncate">
        {text}
      </div>
    </Tooltip>
  );
}

/** A summary tile: label on top, a big value, and an optional muted hint that
 *  explains what the number actually means. */
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
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-bg px-3.5 py-3">
      <TruncatedText text={label} className="text-[11px] text-fg-subtle" />
      <TruncatedText
        text={String(value)}
        className={`text-[22px] font-semibold leading-tight tabular-nums ${accent ? "text-accent" : "text-fg"}`}
      />
      {hint && <TruncatedText text={hint} className="text-[10px] text-fg-subtle/80" />}
    </div>
  );
}

/** A donut of each model's share of tokens, with a legend. Uses a CSS
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
        className="relative h-24 w-24 shrink-0 rounded-full"
        style={{ background: `conic-gradient(${stops})` }}
      >
        <div className="absolute inset-[22%] rounded-full bg-bg" />
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
            />
            <TruncatedText
              text={s.label === OTHERS_SLICE ? othersLabel : s.label}
              className="min-w-0 flex-1 text-fg-muted"
            />
            <span className="shrink-0 tabular-nums text-fg-subtle">{formatTokens(s.tokens)}</span>
            <span className="w-9 shrink-0 text-right tabular-nums text-fg-subtle">{s.pct.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Legend row for the token kinds. */
function TokenLegend() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-fg-subtle">
      {TOKEN_KINDS.map((kind) => (
        <span key={kind.key} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: kind.color }} />
          {t(kind.labelKey)}
        </span>
      ))}
    </div>
  );
}

interface TopSessionRowProps {
  session: Pick<TopSession, "id" | "agent" | "title" | "project_cwd">;
  /** Right-aligned figure; omitted for lists without a ranking metric. */
  value?: string;
  onSelect: (id: string) => void;
  onSelectProject: (cwd: string) => void;
}

function TopSessionRow({ session, value, onSelect, onSelectProject }: TopSessionRowProps) {
  const { t } = useTranslation();
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-bg-elevated"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <TruncatedText text={session.title} className="text-sm text-fg" />
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
        {value !== undefined && <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{value}</span>}
      </button>
    </li>
  );
}

/**
 * Statistics dashboard shown when no session is selected. Fetches
 * `sessions_stats` on mount, on every `sessions-index:updated` event, and
 * whenever the range changes; renders KPI tiles, a 7-day usage chart, token
 * composition, a GitHub-style activity heatmap (a day click lists that day's
 * sessions), top sessions, tool and model breakdowns, today's hourly
 * activity, and a per-agent weekly digest.
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
  const [range, setRange] = useState<RangeDays>(30);
  const [stats, setStats] = useState<SessionsStats>(EMPTY_STATS);
  const [topTab, setTopTab] = useState<"messages" | "tokens">("messages");
  const [metric, setMetric] = useState<HeatmapMetric>("messages");
  // A heatmap day the user clicked; the sessions card then lists that day's
  // sessions instead of the range's top sessions.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
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

  // Fixed ranges render a full year-long calendar with empty leading months,
  // GitHub-style; "all time" (range null) lets the grid start at the earliest
  // active day.
  const weeks = useMemo(() => {
    const end = new Date();
    const start =
      range === null ? undefined : new Date(end.getFullYear(), end.getMonth(), end.getDate() - HEATMAP_DAYS);
    return heatmapWeeks(stats.heatmap, end, start);
  }, [stats.heatmap, range]);
  const busiestHour = useMemo(() => peakHour(stats.hourly), [stats.hourly]);
  const hourlyPeak = useMemo(() => Math.max(1, ...stats.hourly), [stats.hourly]);
  const donutSlices = useMemo(() => modelSlices(stats.range_models, 6), [stats.range_models]);
  const monthLabels = useMemo(() => heatmapMonthLabels(weeks), [weeks]);
  const rangeCost = useMemo(() => estimateCost(stats.range_models), [stats.range_models]);
  const heatmapPeak = useMemo(() => heatmapMax(stats.heatmap, metric), [stats.heatmap, metric]);
  const week = useMemo(() => dailyUsage(stats.daily_models, new Date()), [stats.daily_models]);
  const weekPeak = useMemo(() => Math.max(1, ...week.map((d) => d.total)), [week]);
  const dayCostPeak = useMemo(() => Math.max(0, ...week.map((d) => d.usd)), [week]);
  const daySessions = useMemo(
    () => (pickedDay ? sessionsActiveOn(sessions, pickedDay) : []),
    [sessions, pickedDay],
  );
  const metricLabel = t(HEATMAP_METRICS.find((m) => m.key === metric)?.labelKey ?? "");
  const toolPeak = Math.max(1, ...stats.top_tools.map((tool) => tool.calls));
  const topSessions = topTab === "messages" ? stats.top_by_messages : stats.top_by_tokens;

  const { cards } = stats;
  const rangeTokens = totalTokens(cards);
  const hitRate = cacheHitRate(cards);
  const composition: Record<TokenKind, number> = {
    cacheRead: cards.cache_read_tokens,
    cacheWrite: cards.cache_write_tokens,
    input: cards.input_tokens,
    output: cards.output_tokens,
  };

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
    <div className="h-full overflow-y-auto bg-bg-inset p-4 @container">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-sm font-semibold text-fg">{t("sessions.dashboard.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            options={RANGE_OPTIONS.map((opt) => ({ key: opt.key, label: t(opt.labelKey) }))}
            value={range}
            onChange={setRange}
          />
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-fg-subtle transition-[color,scale] hover:text-fg active:scale-[0.96]"
          >
            {t("sessions.dashboard.exportCsv")}
          </button>
        </div>
      </div>

      {/* KPI tiles beside the 7-day usage chart; they stack on narrow panes. */}
      <div className="mt-4 grid grid-cols-1 gap-3 @4xl:grid-cols-2">
        <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4 @4xl:grid-cols-4">
          <StatCard
            label={t("sessions.dashboard.cards.sessions")}
            value={cards.sessions.toLocaleString()}
            hint={t("sessions.dashboard.cards.sessionsHint", { count: cards.projects.toLocaleString() })}
          />
          <StatCard
            label={t("sessions.dashboard.cards.messages")}
            value={cards.messages.toLocaleString()}
            hint={t("sessions.dashboard.cards.messagesHint", {
              count: cards.user_messages.toLocaleString(),
            })}
          />
          <StatCard
            label={t("sessions.dashboard.cards.tokens")}
            value={formatTokens(rangeTokens)}
            hint={t("sessions.dashboard.cards.tokensHint", { count: formatTokens(cards.output_tokens) })}
          />
          <StatCard
            accent
            label={t("sessions.dashboard.cards.cost")}
            value={formatUsd(rangeCost)}
            hint={t("sessions.dashboard.cards.costHint")}
          />
          <StatCard
            label={t("sessions.dashboard.cards.cacheHit")}
            value={hitRate === null ? "—" : `${hitRate.toFixed(1)}%`}
            hint={t("sessions.dashboard.cards.cacheHitHint", { count: formatTokens(cards.cache_read_tokens) })}
          />
          <StatCard
            label={t("sessions.dashboard.cards.toolCalls")}
            value={cards.tool_calls.toLocaleString()}
            hint={
              stats.top_tools[0]
                ? t("sessions.dashboard.cards.toolCallsHint", { name: stats.top_tools[0].name })
                : undefined
            }
          />
          <StatCard
            label={t("sessions.dashboard.cards.activeDays")}
            value={cards.active_days.toLocaleString()}
          />
          <StatCard
            label={t("sessions.dashboard.cards.perSession")}
            value={cards.messages_per_session.toFixed(1)}
            hint={t("sessions.dashboard.cards.perSessionHint")}
          />
        </div>

        <Card title={t("sessions.dashboard.weekTitle")} action={<TokenLegend />}>
          <div className="mt-3 flex h-36 flex-1 items-stretch gap-2">
            {week.map((day) => {
              const label = t("sessions.dashboard.weekTooltip", {
                date: day.date,
                tokens: formatTokens(day.total),
                cost: formatUsd({ usd: day.usd, unpricedTokens: day.unpriced ? 1 : 0 }),
              });
              return (
                <Tooltip key={day.date} delayMs={60} label={label} className="flex min-w-0 flex-1">
                  <div aria-label={label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] tabular-nums text-fg-subtle">
                      {day.total > 0 ? formatTokens(day.total) : ""}
                    </span>
                    <div className="flex w-full max-w-9 flex-1 flex-col justify-end">
                      {/* Stacked by token kind, bottom-up in legend order. */}
                      <div
                        className="flex w-full flex-col-reverse overflow-hidden rounded-[3px] bg-border"
                        style={{ height: `${Math.max(2, (day.total / weekPeak) * 100)}%` }}
                      >
                        {day.total > 0 &&
                          TOKEN_KINDS.map((kind) => (
                            <div
                              key={kind.key}
                              style={{ height: `${(day[kind.key] / day.total) * 100}%`, background: kind.color }}
                            />
                          ))}
                      </div>
                    </div>
                    <span className="text-[10px] tabular-nums text-fg-subtle">{day.date.slice(5)}</span>
                    <span
                      className={`text-[10px] tabular-nums ${
                        day.usd > 0 && day.usd === dayCostPeak ? "text-accent" : "text-fg-subtle/80"
                      }`}
                    >
                      {day.usd > 0 ? `$${day.usd.toFixed(2)}` : "—"}
                    </span>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 @4xl:grid-cols-2">
        {/* Where the range's tokens went, as one proportional bar. */}
        <Card title={t("sessions.dashboard.compositionTitle")}>
          {rangeTokens === 0 ? (
            <p className="mt-3 text-xs text-fg-subtle">{t("sessions.dashboard.compositionEmpty")}</p>
          ) : (
            <>
              <div className="mt-3 flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
                {TOKEN_KINDS.filter((kind) => composition[kind.key] > 0).map((kind) => (
                  <div
                    key={kind.key}
                    style={{ flexGrow: composition[kind.key], background: kind.color }}
                    className="min-w-0.5"
                  />
                ))}
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                {TOKEN_KINDS.map((kind) => (
                  <li key={kind.key} className="flex min-w-0 items-baseline gap-2 text-xs">
                    <span className="h-2 w-2 shrink-0 self-center rounded-[2px]" style={{ background: kind.color }} />
                    <TruncatedText text={t(kind.labelKey)} className="min-w-0 flex-1 text-fg-muted" />
                    <span className="shrink-0 tabular-nums text-fg">{formatTokens(composition[kind.key])}</span>
                    <span className="w-11 shrink-0 text-right tabular-nums text-fg-subtle">
                      {((composition[kind.key] / rangeTokens) * 100).toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-auto pt-3 text-[11px] text-fg-subtle">{t("sessions.dashboard.costNote")}</p>
        </Card>

        {/* Model usage as a share donut (readable even with many models). */}
        <Card title={t("sessions.dashboard.modelsTitle")}>
          {donutSlices.length === 0 ? (
            <p className="mt-3 text-xs text-fg-subtle">{t("sessions.dashboard.modelsEmpty")}</p>
          ) : (
            <ModelDonut slices={donutSlices} othersLabel={t("sessions.dashboard.modelsOthers")} />
          )}
        </Card>
      </div>

      <Card
        className="mt-3"
        title={t("sessions.dashboard.heatmapTitle")}
        action={
          <Segmented
            options={HEATMAP_METRICS.map((m) => ({ key: m.key, label: t(m.labelKey) }))}
            value={metric}
            onChange={setMetric}
          />
        }
      >
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
                {weeks.map((cells, weekIndex) =>
                  cells.map((day, dayIndex) => {
                    if (!day) {
                      return <div key={`${weekIndex}-${dayIndex}`} className="h-[14px] w-[14px]" />;
                    }
                    // Compute the label once for both the visual tooltip and
                    // the accessible name, rather than calling t() twice per cell.
                    const label = t("sessions.dashboard.heatmapTooltip", {
                      date: day.date,
                      metric: metricLabel,
                      count: day[metric],
                    });
                    const picked = pickedDay === day.date;
                    return (
                      <Tooltip
                        key={`${weekIndex}-${dayIndex}`}
                        delayMs={60}
                        label={label}
                        className="h-[14px] w-[14px]"
                      >
                        <button
                          type="button"
                          aria-label={label}
                          aria-pressed={picked}
                          disabled={day.messages === 0}
                          onClick={() => setPickedDay(picked ? null : day.date)}
                          className={`block h-[14px] w-[14px] rounded-[3px] enabled:cursor-pointer ${
                            HEATMAP_LEVEL_CLASS[heatmapLevel(day[metric], heatmapPeak)]
                          } ${picked ? "outline-2 outline-offset-1 outline-fg" : ""}`}
                        />
                      </Tooltip>
                    );
                  }),
                )}
              </div>
            </div>

            {/* Legend: what the tile shades mean, less → more. */}
            <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-fg-subtle">
              <span>{t("sessions.dashboard.heatmapHint")}</span>
              <span className="flex items-center gap-1">
                <span>{t("sessions.dashboard.legendLess")}</span>
                {HEATMAP_LEVEL_CLASS.map((cls, i) => (
                  <span key={i} className={`h-[12px] w-[12px] rounded-[3px] ${cls}`} />
                ))}
                <span>{t("sessions.dashboard.legendMore")}</span>
              </span>
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-3 grid grid-cols-1 gap-3 @4xl:grid-cols-2">
        {/* Left: the picked day's sessions, or the range's top sessions. */}
        {pickedDay ? (
          <Card
            title={t("sessions.dashboard.dayTitle", { date: pickedDay })}
            action={
              <button
                type="button"
                onClick={() => setPickedDay(null)}
                className="rounded-md px-2 py-0.5 text-[11px] text-fg-subtle transition-[color,scale] hover:text-fg active:scale-[0.96]"
              >
                {t("sessions.dashboard.dayClear")}
              </button>
            }
          >
            {daySessions.length === 0 ? (
              <p className="mt-3 text-xs text-fg-subtle">{t("sessions.dashboard.dayEmpty")}</p>
            ) : (
              <ul className="mt-2">
                {daySessions.map((session) => (
                  <TopSessionRow
                    key={session.id}
                    session={session}
                    value={session.message_count.toLocaleString()}
                    onSelect={select}
                    onSelectProject={selectProject}
                  />
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <Card
            title={t("sessions.dashboard.topTitle")}
            action={
              <Segmented
                options={[
                  { key: "messages" as const, label: t("sessions.dashboard.topByMessages") },
                  { key: "tokens" as const, label: t("sessions.dashboard.topByTokens") },
                ]}
                value={topTab}
                onChange={setTopTab}
              />
            }
          >
            <ul className="mt-2">
              {topSessions.map((session) => (
                <TopSessionRow
                  key={session.id}
                  session={session}
                  // Token counts easily reach 6-7 digits; group them for readability.
                  value={session.value.toLocaleString()}
                  onSelect={select}
                  onSelectProject={selectProject}
                />
              ))}
            </ul>
          </Card>
        )}

        {/* Right: the range's most-used tools, ranked. */}
        <Card title={t("sessions.dashboard.toolsTitle")}>
          {stats.top_tools.length === 0 ? (
            <p className="mt-3 text-xs text-fg-subtle">{t("sessions.dashboard.toolsEmpty")}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {stats.top_tools.map((tool) => (
                <li key={tool.name} className="flex items-center gap-3 text-xs">
                  <TruncatedText text={tool.name} className="w-28 shrink-0 font-mono text-fg-muted" />
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-accent/70"
                      style={{ width: `${(tool.calls / toolPeak) * 100}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right tabular-nums text-fg-subtle">
                    {tool.calls.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 @4xl:grid-cols-2">
        {/* Activity by hour of day (local). Peak hour emphasized. */}
        <Card title={t("sessions.dashboard.hourlyTitle")}>
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
          <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-fg-subtle">
            <span>0h</span>
            <span>6h</span>
            <span>12h</span>
            <span>18h</span>
            <span>23h</span>
          </div>
        </Card>

        {/* This week's per-agent breakdown. */}
        <Card title={t("sessions.dashboard.weeklyTitle")}>
          {stats.weekly.length === 0 ? (
            <p className="mt-3 text-xs text-fg-subtle">{t("sessions.dashboard.weeklyEmpty")}</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-[10px] text-fg-subtle/80">
                  <th className="pb-1 text-left font-medium">{t("sessions.dashboard.weeklyAgent")}</th>
                  <th className="pb-1 text-right font-medium">{t("sessions.dashboard.weeklySessions")}</th>
                  <th className="pb-1 text-right font-medium">{t("sessions.dashboard.weeklyMessages")}</th>
                  <th className="pb-1 text-right font-medium">{t("sessions.dashboard.weeklyTokens")}</th>
                  <th className="pb-1 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      {t("sessions.dashboard.weeklyCost")}
                      <span className="rounded border border-border-strong px-1 text-[8px] text-fg-subtle">
                        USD
                      </span>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.weekly.map((row) => {
                  const costInfo = estimateCost(row.models);
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
                        {formatTokens(row.tokens)}
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
        </Card>
      </div>
    </div>
  );
}
