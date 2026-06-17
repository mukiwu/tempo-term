import { describe, expect, it } from "vitest";
import { basename, dirname, joinPath, relativePath } from "./paths";

describe("basename", () => {
  it("returns the final segment", () => {
    expect(basename("/a/b/c.txt")).toBe("c.txt");
    expect(basename("/a/b/c")).toBe("c");
  });

  it("ignores trailing slashes", () => {
    expect(basename("/a/b/")).toBe("b");
  });

  it("handles Windows separators", () => {
    expect(basename("C:\\Users\\me\\file.txt")).toBe("file.txt");
  });
});

describe("dirname", () => {
  it("returns the parent directory", () => {
    expect(dirname("/a/b/c.txt")).toBe("/a/b");
  });

  it("ignores a trailing slash on the input", () => {
    expect(dirname("/a/b/c/")).toBe("/a/b");
  });

  it("keeps the root slash for a top-level entry", () => {
    expect(dirname("/file.txt")).toBe("/");
  });

  it("handles Windows separators", () => {
    expect(dirname("C:\\Users\\me\\file.txt")).toBe("C:\\Users\\me");
  });
});

describe("joinPath", () => {
  it("joins with the directory's separator", () => {
    expect(joinPath("/a/b", "c.txt")).toBe("/a/b/c.txt");
  });

  it("does not double the separator", () => {
    expect(joinPath("/a/b/", "c.txt")).toBe("/a/b/c.txt");
    expect(joinPath("/a/b", "/c.txt")).toBe("/a/b/c.txt");
  });

  it("uses backslashes on Windows-style directories", () => {
    expect(joinPath("C:\\a\\b", "c.txt")).toBe("C:\\a\\b\\c.txt");
  });
});

describe("relativePath", () => {
  it("strips the root prefix", () => {
    expect(relativePath("/root/src/index.ts", "/root")).toBe("src/index.ts");
  });

  it("tolerates a trailing slash on the root", () => {
    expect(relativePath("/root/src/index.ts", "/root/")).toBe("src/index.ts");
  });

  it("returns the basename when the path is the root itself", () => {
    expect(relativePath("/root", "/root")).toBe("root");
  });

  it("returns the absolute path when it is outside the root", () => {
    expect(relativePath("/other/file.ts", "/root")).toBe("/other/file.ts");
  });

  it("does not treat a sibling with a shared prefix as inside the root", () => {
    // "/root-extra" must not be seen as living under "/root".
    expect(relativePath("/root-extra/file.ts", "/root")).toBe("/root-extra/file.ts");
  });
});
