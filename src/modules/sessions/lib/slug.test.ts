import { describe, expect, it } from "vitest";
import { slugifyTitle } from "./slug";

describe("slugifyTitle", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugifyTitle("Fix flaky test")).toBe("fix-flaky-test");
  });

  it("collapses runs of whitespace, punctuation, and repeated dashes into one dash", () => {
    expect(slugifyTitle("  Multiple   spaces--and--dashes!! ")).toBe("multiple-spaces-and-dashes");
  });

  it("falls back to 'session' for an empty title", () => {
    expect(slugifyTitle("")).toBe("session");
  });

  it("falls back to 'session' when nothing survives (all-CJK/emoji title)", () => {
    expect(slugifyTitle("偵錯報告🎉")).toBe("session");
  });

  it("caps the result at 60 characters", () => {
    const title = "a".repeat(70);
    const slug = slugifyTitle(title);
    expect(slug).toHaveLength(60);
    expect(slug).toBe("a".repeat(60));
  });

  it("trims a trailing dash left dangling by the 60-character cap", () => {
    // Byte 59 (0-indexed) lands exactly on the separator between the two
    // words, so a naive slice(0, 60) would end in "-".
    const title = "x".repeat(59) + " " + "y".repeat(10);
    const slug = slugifyTitle(title);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toBe("x".repeat(59));
  });
});
