import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relativeTime";

const NOW = new Date("2026-07-06T12:00:00.000Z").getTime();

// Same stub convention as the sessions components' `react-i18next` mocks
// (see SessionsPanel.test.tsx / SessionsTabContent.test.tsx): render the key
// plus any `count` interpolation, instead of pulling in real i18next just to
// exercise this pure function's branch selection.
const t = (key: string, options?: Record<string, unknown>) =>
  options?.count !== undefined ? `${key}:${options.count}` : key;

describe("formatRelativeTime", () => {
  it("shows the just-now key for anything under a minute old", () => {
    expect(formatRelativeTime(NOW, t, NOW)).toBe("sessions.time.justNow");
    expect(formatRelativeTime(NOW - 59_000, t, NOW)).toBe("sessions.time.justNow");
  });

  it("shows minutes ago from 1 minute up to just under an hour", () => {
    expect(formatRelativeTime(NOW - 60_000, t, NOW)).toBe("sessions.time.minutesAgo:1");
    expect(formatRelativeTime(NOW - 5 * 60_000, t, NOW)).toBe("sessions.time.minutesAgo:5");
    expect(formatRelativeTime(NOW - (60 * 60_000 - 1), t, NOW)).toBe("sessions.time.minutesAgo:59");
  });

  it("shows hours ago from 1 hour up to just under a day", () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, t, NOW)).toBe("sessions.time.hoursAgo:1");
    expect(formatRelativeTime(NOW - 3 * 60 * 60_000, t, NOW)).toBe("sessions.time.hoursAgo:3");
    expect(formatRelativeTime(NOW - (24 * 60 * 60_000 - 1), t, NOW)).toBe("sessions.time.hoursAgo:23");
  });

  it("shows days ago from 1 day up to just under a week", () => {
    expect(formatRelativeTime(NOW - 24 * 60 * 60_000, t, NOW)).toBe("sessions.time.daysAgo:1");
    expect(formatRelativeTime(NOW - 2 * 24 * 60 * 60_000, t, NOW)).toBe("sessions.time.daysAgo:2");
    expect(formatRelativeTime(NOW - (7 * 24 * 60 * 60_000 - 1), t, NOW)).toBe("sessions.time.daysAgo:6");
  });

  it("falls back to an absolute local date at a week or older", () => {
    // NOW is 2026-07-06T12:00:00Z; exactly 7 days earlier is 2026-06-29T12:00:00Z.
    expect(formatRelativeTime(NOW - 7 * 24 * 60 * 60_000, t, NOW)).toBe("2026-06-29");
  });

  it("defaults `now` to the current time when omitted", () => {
    expect(formatRelativeTime(Date.now(), t)).toBe("sessions.time.justNow");
  });
});
