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
