import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relativeTime";

const NOW = new Date("2026-07-06T12:00:00.000Z").getTime();

describe("formatRelativeTime", () => {
  it("shows 'just now' for anything under a minute old", () => {
    expect(formatRelativeTime(NOW, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe("just now");
  });

  it("shows minutes ago from 1 minute up to just under an hour", () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe("1m ago");
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(formatRelativeTime(NOW - (60 * 60_000 - 1), NOW)).toBe("59m ago");
  });

  it("shows hours ago from 1 hour up to just under a day", () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe("1h ago");
    expect(formatRelativeTime(NOW - 3 * 60 * 60_000, NOW)).toBe("3h ago");
    expect(formatRelativeTime(NOW - (24 * 60 * 60_000 - 1), NOW)).toBe("23h ago");
  });

  it("shows days ago from 1 day up to just under a week", () => {
    expect(formatRelativeTime(NOW - 24 * 60 * 60_000, NOW)).toBe("1d ago");
    expect(formatRelativeTime(NOW - 2 * 24 * 60 * 60_000, NOW)).toBe("2d ago");
    expect(formatRelativeTime(NOW - (7 * 24 * 60 * 60_000 - 1), NOW)).toBe("6d ago");
  });

  it("falls back to an absolute local date at a week or older", () => {
    // NOW is 2026-07-06T12:00:00Z; exactly 7 days earlier is 2026-06-29T12:00:00Z.
    expect(formatRelativeTime(NOW - 7 * 24 * 60 * 60_000, NOW)).toBe("2026-06-29");
  });

  it("defaults `now` to the current time when omitted", () => {
    expect(formatRelativeTime(Date.now())).toBe("just now");
  });
});
