import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyRank } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches an empty query against anything", () => {
    expect(fuzzyMatch("", "anything").matched).toBe(true);
  });

  it("matches a subsequence and reports the matched indices", () => {
    const result = fuzzyMatch("app", "App.tsx");
    expect(result.matched).toBe(true);
    expect(result.indices).toEqual([0, 1, 2]);
  });

  it("matches non-contiguous subsequences", () => {
    expect(fuzzyMatch("atx", "App.tsx").matched).toBe(true);
  });

  it("does not match when characters are missing or out of order", () => {
    expect(fuzzyMatch("xpz", "App.tsx").matched).toBe(false);
    expect(fuzzyMatch("ppa", "App.tsx").matched).toBe(false);
  });

  it("is case insensitive", () => {
    expect(fuzzyMatch("APP", "app.tsx").matched).toBe(true);
  });

  it("scores a contiguous match higher than a scattered one", () => {
    const contiguous = fuzzyMatch("tab", "TabBar.tsx");
    const scattered = fuzzyMatch("tab", "t-a-x-b.tsx");
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });
});

describe("fuzzyRank", () => {
  const files = [
    "src/modules/terminal/TerminalView.tsx",
    "src/modules/settings/SettingsView.tsx",
    "src/App.tsx",
    "README.md",
  ];

  it("keeps only matching items", () => {
    const ranked = fuzzyRank("settings", files);
    expect(ranked).toEqual(["src/modules/settings/SettingsView.tsx"]);
  });

  it("returns everything for an empty query", () => {
    expect(fuzzyRank("", files)).toHaveLength(files.length);
  });

  it("orders better matches first", () => {
    const ranked = fuzzyRank("view", files);
    expect(ranked[0]).toMatch(/View\.tsx$/);
  });
});
