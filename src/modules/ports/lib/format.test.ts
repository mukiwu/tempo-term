import { describe, expect, it } from "vitest";
import { formatUptime } from "./format";

describe("formatUptime", () => {
  it("formats seconds, minutes, hours, and days", () => {
    expect(formatUptime(45)).toBe("45s");
    expect(formatUptime(90)).toBe("1m");
    expect(formatUptime(3660)).toBe("1h 1m");
    expect(formatUptime(93600)).toBe("1d 2h");
  });
});
