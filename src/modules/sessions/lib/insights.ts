import type { ModelTokens } from "./statsBridge";

/** A model's slice of total output tokens, for the usage donut. The label is
 *  the model id, or the sentinel "__others__" for the aggregated tail. */
export interface ModelSlice {
  label: string;
  tokens: number;
  /** Share of the range's total output tokens, 0..100. */
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
    .filter((m) => m.output_tokens > 0)
    .sort((a, b) => b.output_tokens - a.output_tokens);
  const total = sorted.reduce((sum, m) => sum + m.output_tokens, 0);
  if (total === 0) {
    return [];
  }
  const head = sorted.slice(0, maxSlices);
  const tail = sorted.slice(maxSlices);
  const slices: ModelSlice[] = head.map((m) => ({
    label: m.model,
    tokens: m.output_tokens,
    pct: (m.output_tokens / total) * 100,
  }));
  if (tail.length > 0) {
    const tokens = tail.reduce((sum, m) => sum + m.output_tokens, 0);
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
