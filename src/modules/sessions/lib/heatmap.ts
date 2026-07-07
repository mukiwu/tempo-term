import type { HeatmapDay, HeatmapMetric } from "./statsBridge";

/** Cap on how many week columns the calendar heatmap renders, even for the
 *  "all time" range filter — mirrors GitHub's own contribution graph, which
 *  never shows more than roughly a year of history at once. */
const MAX_WEEKS = 53;
const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parses a "YYYY-MM-DD" date string (the backend's local-calendar format)
 *  into a local-midnight `Date`, avoiding the UTC shift `new Date(string)`
 *  would otherwise introduce. */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The Sunday that starts the calendar week containing `d`. */
function weekStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
}

/**
 * Lays out sparse per-day activity counts (only days with at least one
 * message are present in `days`, per the backend) into a GitHub-style
 * calendar grid: an array of weeks, oldest first, each holding 7 day cells
 * (Sunday..Saturday). The grid spans from the earliest date in `days`
 * through `end`, capped to the most recent `MAX_WEEKS` weeks when that span
 * is longer — older weeks are dropped entirely rather than rendered.
 *
 * A cell is `null` when it falls outside the visible range: before the
 * earliest real date (leading partial week, only when the span isn't
 * capped) or after `end` (trailing partial week in the current one). Every
 * other in-range day is a `HeatmapDay`, defaulting `messages` to 0 when
 * `days` has no entry for that date.
 */
export function heatmapWeeks(
  days: HeatmapDay[],
  end: Date,
  start?: Date,
): (HeatmapDay | null)[][] {
  // With an explicit `start` the grid spans the whole selected window (empty
  // leading months included, so a fixed 30/90/365-day range always renders a
  // full, GitHub-style calendar). Without one it falls back to spanning from
  // the earliest day that actually has activity — the right behavior for the
  // open-ended "all time" range.
  if (days.length === 0 && !start) {
    return [];
  }

  const endDay = startOfDay(end);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const dataStart = days
    .map((d) => parseLocalDate(d.date))
    .reduce((earliest, d) => (d.getTime() < earliest.getTime() ? d : earliest), endDay);
  const realStart = start ? startOfDay(start) : dataStart;

  const endWeekStart = weekStart(endDay);
  const realStartWeekStart = weekStart(realStart);
  // Ms division is safe *here*: both operands are local midnights, so a DST
  // transition inside the span skews the diff by at most an hour, and
  // rounding to whole weeks absorbs it exactly.
  const weeksBetween =
    Math.round((endWeekStart.getTime() - realStartWeekStart.getTime()) / (DAYS_PER_WEEK * MS_PER_DAY)) + 1;
  const totalWeeks = Math.min(Math.max(weeksBetween, 1), MAX_WEEKS);

  // Anchored to `endWeekStart` (not `realStartWeekStart`) so capping drops
  // the oldest weeks instead of shifting `end` out of the grid. Date
  // *construction* must use calendar arithmetic (day-field offsets), never
  // raw ms addition: stepping across a DST transition by ms lands an hour
  // off local midnight, mislabeling every cell on the far side of the
  // change (and skipping/duplicating the transition day itself).
  const gridStart = new Date(
    endWeekStart.getFullYear(),
    endWeekStart.getMonth(),
    endWeekStart.getDate() - (totalWeeks - 1) * DAYS_PER_WEEK,
  );
  const lowerBound = realStart.getTime() > gridStart.getTime() ? realStart : gridStart;

  const weeks: (HeatmapDay | null)[][] = [];
  for (let w = 0; w < totalWeeks; w++) {
    const week: (HeatmapDay | null)[] = [];
    for (let row = 0; row < DAYS_PER_WEEK; row++) {
      const cellDate = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + w * DAYS_PER_WEEK + row,
      );
      if (cellDate.getTime() < lowerBound.getTime() || cellDate.getTime() > endDay.getTime()) {
        week.push(null);
      } else {
        const key = toDateKey(cellDate);
        week.push(byDate.get(key) ?? { date: key, messages: 0, sessions: 0, output_tokens: 0 });
      }
    }
    weeks.push(week);
  }
  return weeks;
}

/** The largest value of `metric` across all days, for scaling intensity.
 *  Returns 0 for an empty set, which callers treat as "everything level 0". */
export function heatmapMax(days: HeatmapDay[], metric: HeatmapMetric): number {
  return days.reduce((max, d) => Math.max(max, d[metric]), 0);
}

/**
 * Intensity level 0..4 for a cell's `value` relative to the range's `max`.
 * Level 0 is no activity; 1..4 split the (0, max] span into quartiles, so the
 * ramp adapts to whichever metric is shown (a few sessions/day and thousands
 * of tokens/day both fill the scale) instead of fixed message thresholds that
 * would peg tokens permanently at the top and sessions at the bottom.
 */
export function heatmapLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) {
    return 0;
  }
  const level = Math.ceil((value / max) * 4);
  return Math.min(Math.max(level, 1), 4) as 1 | 2 | 3 | 4;
}

/**
 * One label per week column for the month strip above the heatmap: the
 * month index (0=Jan..11=Dec) of a week whose earliest real day belongs to a
 * month not yet seen, and `null` for every other column. Mirrors GitHub's
 * contribution graph, which prints a month name only where that month first
 * enters the grid. The component formats the index into a localized short
 * month name.
 */
export function heatmapMonthLabels(weeks: (HeatmapDay | null)[][]): (number | null)[] {
  let lastMonth = -1;
  return weeks.map((week) => {
    const firstReal = week.find((cell): cell is HeatmapDay => cell !== null);
    if (!firstReal) {
      return null;
    }
    const month = parseLocalDate(firstReal.date).getMonth();
    if (month === lastMonth) {
      return null;
    }
    lastMonth = month;
    return month;
  });
}
