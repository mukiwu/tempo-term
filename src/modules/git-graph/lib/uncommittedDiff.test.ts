import { describe, expect, it } from "vitest";
import { sliceFileDiff, untrackedDiffLines } from "./uncommittedDiff";

const TWO_FILES = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  "-old a",
  "+new a",
  "diff --git a/src/b.ts b/src/b.ts",
  "index 333..444 100644",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1 @@",
  "-old b",
  "+new b",
  "",
].join("\n");

describe("sliceFileDiff", () => {
  it("cuts the first file's section without bleeding into the next", () => {
    const out = sliceFileDiff(TWO_FILES, "src/a.ts");
    expect(out).toBe(
      [
        "diff --git a/src/a.ts b/src/a.ts",
        "index 111..222 100644",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,2 +1,2 @@",
        "-old a",
        "+new a",
        "",
      ].join("\n"),
    );
    expect(out).not.toContain("b.ts");
  });

  it("cuts the last file's section, which no later header terminates", () => {
    const out = sliceFileDiff(TWO_FILES, "src/b.ts");
    expect(out).toContain("+new b");
    expect(out).not.toContain("a.ts");
  });

  it("answers empty for a path the diff never mentions", () => {
    // The honest answer for an untracked file, or one changed on the other
    // side (staged vs unstaged) than the diff being sliced.
    expect(sliceFileDiff(TWO_FILES, "src/never.ts")).toBe("");
    expect(sliceFileDiff("", "src/a.ts")).toBe("");
    expect(sliceFileDiff(TWO_FILES, "")).toBe("");
  });

  it("does not match a path that is only a suffix of another", () => {
    // "a.ts" must not pull out "src/a.ts": the header is matched on the whole
    // b-side path, not on any trailing fragment of it.
    expect(sliceFileDiff(TWO_FILES, "a.ts")).toBe("");
  });

  it("finds a path git had to quote", () => {
    const quoted = [
      'diff --git "a/src/od d.ts" "b/src/od d.ts"',
      "@@ -1 +1 @@",
      "+x",
      "",
    ].join("\n");
    expect(sliceFileDiff(quoted, "src/od d.ts")).toContain("+x");
  });

  it("still finds the header when the line carries a trailing CR", () => {
    // git ends its own header lines with \n, so this should not come from
    // `git_diff` — but a header that misses by one invisible byte returns
    // nothing, and nothing looks exactly like "no changes on this side".
    const crlf = TWO_FILES.split("\n").join("\r\n");
    const out = sliceFileDiff(crlf, "src/a.ts");
    expect(out).toContain("+new a");
    expect(out).not.toContain("b.ts");
  });

  it("finds a rename under the name the caller knows it by", () => {
    // The b-side is the new path, which is what the file list shows.
    const renamed = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 90%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "",
    ].join("\n");
    expect(sliceFileDiff(renamed, "src/new.ts")).toContain("rename to src/new.ts");
    expect(sliceFileDiff(renamed, "src/old.ts")).toBe("");
  });
});

describe("untrackedDiffLines", () => {
  it("renders the whole file as one added hunk", () => {
    const lines = untrackedDiffLines("src/new.ts", "one\ntwo\n");
    expect(lines.map((l) => l.kind)).toEqual(["meta", "meta", "hunk", "add", "add"]);
    expect(lines[2].text).toBe("@@ -0,0 +1,2 @@");
    expect(lines.slice(3).map((l) => l.text)).toEqual(["+one", "+two"]);
  });

  it("does not invent a line for the trailing newline", () => {
    expect(untrackedDiffLines("a.txt", "only\n").filter((l) => l.kind === "add")).toHaveLength(1);
  });

  it("handles an empty new file", () => {
    const lines = untrackedDiffLines("empty.txt", "");
    expect(lines.filter((l) => l.kind === "add")).toHaveLength(0);
    expect(lines[2].text).toBe("@@ -0,0 +1,0 @@");
  });
});
