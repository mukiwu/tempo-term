import { describe, expect, it } from "vitest";
import { formatCommentPrompt, reanchorComments } from "./commentPrompt";
import type { DiffComment } from "./diffCommentStore";

function comment(over: Partial<DiffComment>): DiffComment {
  return {
    id: "c1",
    path: "/repo/a.ts",
    staged: false,
    side: "b",
    line: 3,
    lineText: "const x = 1;",
    body: "rename this",
    sent: false,
    ...over,
  };
}

describe("formatCommentPrompt", () => {
  it("groups comments by file and orders them by line", () => {
    const prompt = formatCommentPrompt([
      comment({ id: "1", path: "/repo/b.ts", line: 10, body: "b file" }),
      comment({ id: "2", path: "/repo/a.ts", line: 8, body: "later" }),
      comment({ id: "3", path: "/repo/a.ts", line: 2, body: "earlier" }),
    ]);
    expect(prompt).toContain("## /repo/a.ts");
    expect(prompt).toContain("## /repo/b.ts");
    expect(prompt.indexOf("earlier")).toBeLessThan(prompt.indexOf("later"));
  });

  it("anchors each comment with its captured line text", () => {
    const prompt = formatCommentPrompt([comment({ lineText: "  const x = 1;" })]);
    expect(prompt).toContain("Line 3, `const x = 1;`:");
  });

  it("labels old-side comments and keeps multi-line bodies", () => {
    const prompt = formatCommentPrompt([
      comment({ side: "a", body: "first row\nsecond row" }),
    ]);
    expect(prompt).toContain("Line 3 (old version)");
    expect(prompt).toContain("  first row\n  second row");
  });
});

describe("reanchorComments", () => {
  const doc = ["alpha", "beta", "gamma", "beta", "delta"];

  it("keeps a comment whose line still matches", () => {
    expect(reanchorComments([comment({ line: 2, lineText: "beta" })], doc)).toEqual([]);
  });

  it("moves a shifted comment to the nearest matching line", () => {
    expect(reanchorComments([comment({ line: 5, lineText: "beta" })], doc)).toEqual([
      { id: "c1", line: 4 },
    ]);
  });

  it("leaves a comment alone when its text no longer exists", () => {
    expect(reanchorComments([comment({ line: 2, lineText: "vanished" })], doc)).toEqual([]);
  });

  it("never re-anchors a comment on a blank line", () => {
    const blankDoc = ["alpha", "", "gamma", ""];
    expect(reanchorComments([comment({ line: 2, lineText: "" })], blankDoc)).toEqual([]);
    expect(reanchorComments([comment({ line: 3, lineText: "  " })], blankDoc)).toEqual([]);
  });
});
