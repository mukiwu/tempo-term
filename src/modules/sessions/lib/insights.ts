import type { HeatmapDay } from "./statsBridge";

/** Consecutive-active-day streaks derived from the set of dates that have any
 *  activity. `current` counts back from today (or yesterday, so a day that
 *  hasn't started yet doesn't break it); `longest` is the longest run anywhere
 *  in the range. Both are 0 when there's no activity. */
export interface Streaks {
  current: number;
  longest: number;
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayNumber(d: Date): number {
  // Whole local days since epoch, so consecutive calendar dates differ by 1
  // regardless of DST (midnight-to-midnight is compared, not elapsed hours).
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
}

/** `today` is injected so the calc is testable and deterministic. */
export function computeStreaks(days: HeatmapDay[], today: Date): Streaks {
  if (days.length === 0) {
    return { current: 0, longest: 0 };
  }
  const nums = [...new Set(days.map((d) => dayNumber(parseLocalDate(d.date))))].sort((a, b) => a - b);

  let longest = 1;
  let run = 1;
  for (let i = 1; i < nums.length; i++) {
    run = nums[i] === nums[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  // Current streak: walk back from the most recent active day only if it is
  // today or yesterday (an untouched fresh day shouldn't zero the streak).
  const todayNum = dayNumber(today);
  const active = new Set(nums);
  let current = 0;
  if (active.has(todayNum) || active.has(todayNum - 1)) {
    let cursor = active.has(todayNum) ? todayNum : todayNum - 1;
    while (active.has(cursor)) {
      current++;
      cursor--;
    }
  }

  return { current, longest };
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
