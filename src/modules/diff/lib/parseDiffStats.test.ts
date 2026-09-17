import { describe, expect, it } from "vitest";
import { changedLines, estimatedRows, parseDiffStats } from "./parseDiffStats";

describe("parseDiffStats", () => {
  it("counts a file's added and deleted lines", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,4 +1,5 @@",
      " keep",
      "-gone",
      "+new one",
      "+new two",
      " keep",
      "",
    ].join("\n");

    const stats = parseDiffStats(diff).get("src/a.ts");
    expect(stats).toMatchObject({ added: 2, deleted: 1, binary: false });
    // The hunk starts at line 1 of the new document and reads as its wider
    // side (5 new lines against 4 old).
    expect(stats?.hunks).toEqual([{ line: 1, size: 5 }]);
  });

  it("keys every file in a multi-file diff", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/dir/b.md b/dir/b.md",
      "--- a/dir/b.md",
      "+++ b/dir/b.md",
      "@@ -10,2 +10,3 @@ heading",
      " x",
      "+y",
      " z",
      "",
    ].join("\n");

    const files = parseDiffStats(diff);
    expect([...files.keys()]).toEqual(["a.ts", "dir/b.md"]);
    expect(files.get("dir/b.md")).toMatchObject({ added: 1, deleted: 0 });
    expect(files.get("dir/b.md")?.hunks).toEqual([{ line: 10, size: 3 }]);
  });

  it("keys a deleted file by its old path", () => {
    const diff = [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-one",
      "-two",
      "",
    ].join("\n");

    const stats = parseDiffStats(diff).get("gone.ts");
    expect(stats).toMatchObject({ added: 0, deleted: 2 });
    // Nothing is left on the new side, so the hunk anchors at the first line.
    expect(stats?.hunks).toEqual([{ line: 1, size: 2 }]);
  });

  it("marks a binary file, which has no lines to count", () => {
    const diff = [
      "diff --git a/logo.png b/logo.png",
      "index 3333333..4444444 100644",
      "Binary files a/logo.png and b/logo.png differ",
      "",
    ].join("\n");

    const stats = parseDiffStats(diff).get("logo.png");
    expect(stats).toMatchObject({ added: 0, deleted: 0, binary: true, hunks: [] });
    expect(estimatedRows(stats!)).toBe(0);
  });

  it("reads a rename by the name it lands under", () => {
    const diff = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 90%",
      "rename from old.ts",
      "rename to new.ts",
      "--- a/old.ts",
      "+++ b/new.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
    ].join("\n");

    const stats = parseDiffStats(diff);
    expect([...stats.keys()]).toEqual(["new.ts"]);
    // And under the name it left, which is the only name its old side has.
    expect(stats.get("new.ts")?.from).toBe("old.ts");
  });

  it("does not mistake a diff's own lines for file headers", () => {
    // A patch file under version control: its content lines are themselves
    // diff headers, and only the leading +/- tells them apart.
    const diff = [
      "diff --git a/fix.patch b/fix.patch",
      "--- a/fix.patch",
      "+++ b/fix.patch",
      "@@ -1,3 +1,4 @@",
      " diff --git a/inner.c b/inner.c",
      "-  --- a/inner.c",
      "+  +++ b/inner.c",
      "+  @@ -1 +1 @@",
      " end",
      "",
    ].join("\n");

    const files = parseDiffStats(diff);
    expect([...files.keys()]).toEqual(["fix.patch"]);
    expect(files.get("fix.patch")).toMatchObject({ added: 2, deleted: 1 });
    // The inner "@@" line is content, not a second hunk.
    expect(files.get("fix.patch")?.hunks).toHaveLength(1);
  });

  it("unquotes a path git escaped", () => {
    const diff = [
      'diff --git "a/has space.ts" "b/has space.ts"',
      '--- "a/has space.ts"',
      '+++ "b/has space.ts"',
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
    ].join("\n");

    expect([...parseDiffStats(diff).keys()]).toEqual(["has space.ts"]);
  });

  it("decodes a non-ASCII path git escaped as UTF-8 octal bytes", () => {
    const escapedPath = "\\346\\234\\254\\350\\252\\236.ts";
    const diff = [
      `diff --git "a/${escapedPath}" "b/${escapedPath}"`,
      `--- "a/${escapedPath}"`,
      `+++ "b/${escapedPath}"`,
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
    ].join("\n");

    expect([...parseDiffStats(diff).keys()]).toEqual(["本語.ts"]);
  });

  it("leaves `from` unset for a file that did not move", () => {
    const diff = [
      "diff --git a/same.ts b/same.ts",
      "--- a/same.ts",
      "+++ b/same.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
    ].join("\n");

    expect(parseDiffStats(diff).get("same.ts")?.from).toBeUndefined();
  });

  it("says what happened to a file instead of guessing from the counts", () => {
    // The counts cannot tell these apart: the first file and the second both
    // have nothing on their old side by the numbers, and only the header says
    // which of them is actually new.
    const diff = [
      "diff --git a/grew.ts b/grew.ts",
      "index 1111111..2222222 100644",
      "--- a/grew.ts",
      "+++ b/grew.ts",
      "@@ -1,2 +1,4 @@",
      " keep",
      "+one",
      "+two",
      " end",
      "diff --git a/fresh.ts b/fresh.ts",
      "new file mode 100644",
      "index 0000000..3333333",
      "--- /dev/null",
      "+++ b/fresh.ts",
      "@@ -0,0 +1 @@",
      "+hello",
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "diff --git a/old.ts b/moved.ts",
      "similarity index 100%",
      "rename from old.ts",
      "rename to moved.ts",
      "",
    ].join("\n");

    const files = parseDiffStats(diff);
    // An edit that only added lines is an edit. Reading it as an addition is
    // what the all-changes list used to do, and it did it to most files in
    // most commits.
    expect(files.get("grew.ts")?.status).toBe("M");
    expect(files.get("fresh.ts")?.status).toBe("A");
    expect(files.get("gone.ts")?.status).toBe("D");
    expect(files.get("moved.ts")?.status).toBe("R");
  });

  it("does not mistake a diff's own lines for file headers", () => {
    // A patch file under version control: its content lines are themselves
    // diff headers, and only the leading +/- tells them apart.
    const diff = [
      "diff --git a/fix.patch b/fix.patch",
      "--- a/fix.patch",
      "+++ b/fix.patch",
      "@@ -1,3 +1,4 @@",
      " diff --git a/inner.c b/inner.c",
      "-  --- a/inner.c",
      "+  +++ b/inner.c",
      "+  @@ -1 +1 @@",
      " end",
      "",
    ].join("\n");

    const files = parseDiffStats(diff);
    expect([...files.keys()]).toEqual(["fix.patch"]);
    expect(files.get("fix.patch")).toMatchObject({ added: 2, deleted: 1 });
    // The inner "@@" line is content, not a second hunk.
    expect(files.get("fix.patch")?.hunks).toHaveLength(1);
  });

  it("unquotes a path git escaped", () => {
    const diff = [
      'diff --git "a/has space.ts" "b/has space.ts"',
      '--- "a/has space.ts"',
      '+++ "b/has space.ts"',
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
    ].join("\n");

    expect([...parseDiffStats(diff).keys()]).toEqual(["has space.ts"]);
  });

  it("estimates the rows a collapsed comparison renders", () => {
    const stats = {
      added: 4,
      deleted: 2,
      binary: false,
      status: "M",
      hunks: [
        { line: 1, size: 6 },
        { line: 40, size: 4 },
      ],
    };
    // Both hunks, plus a collapsed bar between and around them.
    expect(estimatedRows(stats)).toBe(6 + 4 + 3);
    expect(changedLines(stats)).toBe(6);
  });
});
