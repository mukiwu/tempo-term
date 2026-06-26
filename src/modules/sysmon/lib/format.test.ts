import { describe, expect, it } from "vitest";
import { formatBytes, formatPercent, formatRate, ramPercent } from "./format";

describe("formatBytes", () => {
  it("formats byte counts into human-readable units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1048576)).toBe("1.0 MB");
    expect(formatBytes(1073741824)).toBe("1.0 GB");
  });
});

describe("formatRate", () => {
  it("formats a byte-per-second rate with a /s suffix", () => {
    expect(formatRate(0)).toBe("0 B/s");
    expect(formatRate(1024)).toBe("1.0 KB/s");
    expect(formatRate(1500000)).toBe("1.4 MB/s");
  });
});

describe("formatPercent", () => {
  it("rounds a 0–100 value to a whole-number percent", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(42.6)).toBe("43%");
    expect(formatPercent(100)).toBe("100%");
  });
});

describe("ramPercent", () => {
  it("computes used/total as a 0–100 percentage", () => {
    expect(ramPercent(8, 16)).toBe(50);
    expect(ramPercent(0, 16)).toBe(0);
  });

  it("returns 0 when total is 0 instead of dividing by zero", () => {
    expect(ramPercent(0, 0)).toBe(0);
  });
});
