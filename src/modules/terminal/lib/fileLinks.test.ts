import { describe, expect, it } from "vitest";
import { findFilePaths, resolveFilePath } from "./fileLinks";

describe("findFilePaths", () => {
  it("finds a relative path with a line number", () => {
    const matches = findFilePaths("  at src/modules/App.tsx:42:7 in render");
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("src/modules/App.tsx:42:7");
  });

  it("finds absolute and dot-relative paths", () => {
    expect(findFilePaths("see /Users/me/x.rs and ./lib/y.ts").map((m) => m.text)).toEqual([
      "/Users/me/x.rs",
      "./lib/y.ts",
    ]);
  });

  it("reports correct offsets", () => {
    const [m] = findFilePaths("edit App.tsx now");
    expect("edit App.tsx now".slice(m.start, m.end)).toBe("App.tsx");
  });

  it("ignores plain words without an extension", () => {
    expect(findFilePaths("just some regular words here")).toEqual([]);
  });

  it("matches a path whose filename contains CJK characters", () => {
    const line = "exists docs/specs/2026-06-19-新點首頁三新風格EFG-design.md, checked";
    const matches = findFilePaths(line);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("docs/specs/2026-06-19-新點首頁三新風格EFG-design.md");
  });

  it("matches a path with a CJK directory segment", () => {
    expect(findFilePaths("open 專案/notes.md").map((m) => m.text)).toEqual([
      "專案/notes.md",
    ]);
  });

  it("ignores file-looking tokens inside a web URL but still finds real paths", () => {
    const matches = findFilePaths("see https://muki.tw/a.png and ./src/b.ts").map((m) => m.text);
    expect(matches).toContain("./src/b.ts");
    expect(matches.some((m) => m.includes("muki.tw") || m === "a.png")).toBe(false);
  });
});

describe("resolveFilePath", () => {
  it("returns absolute paths unchanged and strips the line suffix", () => {
    expect(resolveFilePath("/Users/me/x.rs:10", "/cwd")).toBe("/Users/me/x.rs");
  });

  it("joins a relative path onto the cwd", () => {
    expect(resolveFilePath("src/App.tsx:5:2", "/Users/me/proj")).toBe(
      "/Users/me/proj/src/App.tsx",
    );
  });

  it("normalises a leading ./ against the cwd", () => {
    expect(resolveFilePath("./lib/y.ts", "/root/")).toBe("/root/lib/y.ts");
  });

  it("expands a leading ~ when home is known", () => {
    expect(resolveFilePath("~/notes/a.md", null, "/Users/me")).toBe("/Users/me/notes/a.md");
  });
});
