const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Formats `epochMs` relative to `now` (defaults to `Date.now()`) for the
 * sessions list: "just now" under a minute, then minutes/hours/days ago up
 * to a week, then an absolute local "YYYY-MM-DD" date once it's a week old
 * or older — mirrors the Rust side's use of local-calendar dates.
 */
export function formatRelativeTime(epochMs: number, now: number = Date.now()): string {
  const diff = now - epochMs;

  if (diff < MINUTE_MS) {
    return "just now";
  }
  if (diff < HOUR_MS) {
    return `${Math.floor(diff / MINUTE_MS)}m ago`;
  }
  if (diff < DAY_MS) {
    return `${Math.floor(diff / HOUR_MS)}h ago`;
  }
  if (diff < WEEK_MS) {
    return `${Math.floor(diff / DAY_MS)}d ago`;
  }

  const date = new Date(epochMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
