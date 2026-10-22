import { estimateCost, totalTokens } from "./cost";
import type { DailyModelTokens, ModelTokens } from "./statsBridge";
import type { SessionSummary } from "./sessionsBridge";

/** A model's slice of total tokens, for the usage donut. The label is
 *  the model id, or the sentinel "__others__" for the aggregated tail. */
export interface ModelSlice {
  label: string;
  tokens: number;
  /** Share of the range's total tokens, 0..100. */
  pct: number;
}

/** The sentinel label the component renders as a localized "Others". */
export const OTHERS_SLICE = "__others__";

/**
 * Turns per-model token totals into donut slices, largest first, folding
 * everything past `maxSlices` into a single "others" slice — so a user with
 * many models gets a readable chart instead of dozens of hairline wedges.
 * Zero-token models are dropped; an empty/zero input yields no slices.
 */
export function modelSlices(models: ModelTokens[], maxSlices: number): ModelSlice[] {
  const sorted = models
    .map((m) => ({ model: m.model, tokens: totalTokens(m) }))
    .filter((m) => m.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
  const total = sorted.reduce((sum, m) => sum + m.tokens, 0);
  if (total === 0) {
    return [];
  }
  const head = sorted.slice(0, maxSlices);
  const tail = sorted.slice(maxSlices);
  const slices: ModelSlice[] = head.map((m) => ({
    label: m.model,
    tokens: m.tokens,
    pct: (m.tokens / total) * 100,
  }));
  if (tail.length > 0) {
    const tokens = tail.reduce((sum, m) => sum + m.tokens, 0);
    slices.push({ label: OTHERS_SLICE, tokens, pct: (tokens / total) * 100 });
  }
  return slices;
}

/** The hour-of-day (0..23) with the most messages, or `null` when the range
 *  has no activity. Ties resolve to the earliest hour. */
export function peakHour(hourly: number[]): number | null {
  let best = -1;
  let bestHour: number | null = null;
  hourly.forEach((count, hour) => {
    if (count > best) {
      best = count;
      bestHour = hour;
    }
  });
  return best > 0 ? bestHour : null;
}

/** Formats an hour-of-day (0..23) as a 12-hour clock label: 0 → "12 AM",
 *  13 → "1 PM". Matches the compact readout Claude Code's stats use. */
export function formatHour(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${period}`;
}

/** One day of the 7-day usage chart. */
export interface DailyUsage {
  /** Local date, "YYYY-MM-DD". */
  date: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
  usd: number;
  /** True when some of the day's tokens came from models without a price. */
  unpriced: boolean;
}

function dateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Folds the backend's per-(date, model) rows into exactly seven days ending
 * on `end` (oldest first), filling days without activity with zeros so the
 * chart always shows a full week.
 */
export function dailyUsage(rows: DailyModelTokens[], end: Date): DailyUsage[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = dateKey(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6 + i));
    const day = rows.filter((r) => r.date === date);
    const sum = (pick: (r: DailyModelTokens) => number) => day.reduce((acc, r) => acc + pick(r), 0);
    const cost = estimateCost(day);
    const input = sum((r) => r.input_tokens);
    const cacheRead = sum((r) => r.cache_read_tokens);
    const cacheWrite = sum((r) => r.cache_write_tokens);
    const output = sum((r) => r.output_tokens);
    return {
      date,
      input,
      cacheRead,
      cacheWrite,
      output,
      total: input + cacheRead + cacheWrite + output,
      usd: cost.usd,
      unpriced: cost.unpricedTokens > 0,
    };
  });
}

/**
 * Sessions whose start-to-end span overlaps the local calendar day `date`
 * ("YYYY-MM-DD"), newest first. The index stores only a session's first and
 * last timestamps, so a long-running session counts on every day it spans.
 */
export function sessionsActiveOn(sessions: SessionSummary[], date: string): SessionSummary[] {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(year, month - 1, day).getTime();
  const end = new Date(year, month - 1, day + 1).getTime();
  return sessions
    .filter((s) => s.started_at < end && s.ended_at >= start)
    .sort((a, b) => b.ended_at - a.ended_at);
}
