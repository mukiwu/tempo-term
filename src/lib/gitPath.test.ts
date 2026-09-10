import { describe, expect, it } from "vitest";
import { diffHeaderPath, stripGitPathSide, unquoteGitPath } from "./gitPath";

describe("unquoteGitPath", () => {
  it("leaves an unquoted path alone", () => {
    expect(unquoteGitPath("src/a.ts")).toBe("src/a.ts");
  });

  it("leaves a path alone when only one end is quoted", () => {
    expect(unquoteGitPath('"src/a.ts')).toBe('"src/a.ts');
  });

  it("decodes the simple C escapes", () => {
    expect(unquoteGitPath('"a\\tb"')).toBe("a\tb");
    expect(unquoteGitPath('"a\\"b"')).toBe('a"b');
    expect(unquoteGitPath('"a\\\\b"')).toBe("a\\b");
  });

  it("decodes octal escapes as UTF-8 bytes rather than one at a time", () => {
    // Each CJK character is three bytes, and decoding them singly yields
    // mojibake rather than the character — the bytes have to be collected and
    // decoded together.
    expect(unquoteGitPath('"\\344\\270\\255\\346\\226\\207.ts"')).toBe("中文.ts");
  });

  it("decodes a run of bytes that is interrupted by a plain character", () => {
    expect(unquoteGitPath('"\\344\\270\\255x\\346\\226\\207"')).toBe("中x文");
  });

  it("keeps a trailing lone backslash rather than dropping it", () => {
    expect(unquoteGitPath('"a\\"')).toBe("a\\");
  });
});

describe("stripGitPathSide", () => {
  it("drops the side prefix", () => {
    expect(stripGitPathSide("b/src/a.ts", "b/")).toBe("src/a.ts");
    expect(stripGitPathSide("a/src/a.ts", "a/")).toBe("src/a.ts");
  });

  it("unquotes before looking for the prefix", () => {
    expect(stripGitPathSide('"b/\\344\\270\\255\\346\\226\\207.ts"', "b/")).toBe("中文.ts");
  });

  it("leaves a path that does not carry the prefix", () => {
    expect(stripGitPathSide("/dev/null", "b/")).toBe("/dev/null");
  });
});

describe("diffHeaderPath", () => {
  it("reads the new side out of a header", () => {
    expect(diffHeaderPath("diff --git a/src/a.ts b/src/a.ts")).toBe("src/a.ts");
  });

  it("reads the new name of a rename, not the old one", () => {
    expect(diffHeaderPath("diff --git a/old.ts b/new.ts")).toBe("new.ts");
  });

  it("reads a quoted, escaped path", () => {
    expect(
      diffHeaderPath(
        'diff --git "a/\\344\\270\\255\\346\\226\\207.ts" "b/\\344\\270\\255\\346\\226\\207.ts"',
      ),
    ).toBe("中文.ts");
  });

  it("takes the last b/ so a path starting with b/ does not split early", () => {
    expect(diffHeaderPath("diff --git a/b/x.ts b/b/x.ts")).toBe("b/x.ts");
  });

  it("splits in the wrong place for a path holding a space and b/", () => {
    // Documented, not desired: the two halves are separated by " b/" and a
    // path may contain that, with nothing in the header to tell them apart.
    // Callers that have the file's own `+++ b/` line prefer it for this
    // reason; `parseDiffStats` does exactly that.
    expect(diffHeaderPath("diff --git a/x b/y.ts b/x b/y.ts")).toBe("y.ts");
  });

  it("answers null for a line with no new side to read", () => {
    expect(diffHeaderPath("diff --git a/only.ts")).toBeNull();
  });
});
