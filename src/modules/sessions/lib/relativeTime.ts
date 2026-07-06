const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** Minimal shape of an i18next `TFunction` needed here: a key plus optional
 *  interpolation values, always returning a string. Kept narrow instead of
 *  importing the full generic `TFunction` type, which fights structural
 *  typing when a plain stub (as used in this module's own tests, and in the
 *  sessions components' `react-i18next` mocks) is passed in its place. */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Formats `epochMs` relative to `now` (defaults to `Date.now()`) for the
 * sessions list: "just now" under a minute, then minutes/hours/days ago up
 * to a week, then an absolute local "YYYY-MM-DD" date once it's a week old
 * or older — mirrors the Rust side's use of local-calendar dates. The
 * relative phrasing goes through `t` (the `sessions.time.*` keys) so it
 * localizes with the rest of the sessions UI; the absolute date fallback
 * stays locale-neutral, same as the Rust side.
 */
export function formatRelativeTime(epochMs: number, t: Translate, now: number = Date.now()): string {
  const diff = now - epochMs;

  if (diff < MINUTE_MS) {
    return t("sessions.time.justNow");
  }
  if (diff < HOUR_MS) {
    return t("sessions.time.minutesAgo", { count: Math.floor(diff / MINUTE_MS) });
  }
  if (diff < DAY_MS) {
    return t("sessions.time.hoursAgo", { count: Math.floor(diff / HOUR_MS) });
  }
  if (diff < WEEK_MS) {
    return t("sessions.time.daysAgo", { count: Math.floor(diff / DAY_MS) });
  }

  const date = new Date(epochMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
