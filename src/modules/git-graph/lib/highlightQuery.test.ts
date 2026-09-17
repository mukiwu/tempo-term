import { describe, expect, it } from "vitest";
import { splitOnQuery } from "./highlightQuery";

const marked = (text: string, query: string) =>
  splitOnQuery(text, query)
    .filter((r) => r.hit)
    .map((r) => r.text);

const rebuilt = (text: string, query: string) =>
  splitOnQuery(text, query)
    .map((r) => r.text)
    .join("");

describe("splitOnQuery", () => {
  it("leaves the text in one piece when there is nothing to mark", () => {
    // The caller skips its wrapping spans on this shape, so it has to be the
    // answer for both "no query" and "query that does not appear".
    expect(splitOnQuery("fix the lane", "")).toEqual([{ text: "fix the lane", hit: false }]);
    expect(splitOnQuery("fix the lane", "   ")).toEqual([{ text: "fix the lane", hit: false }]);
    expect(splitOnQuery("fix the lane", "zzz")).toEqual([{ text: "fix the lane", hit: false }]);
  });

  it("marks every occurrence, not just the first", () => {
    expect(marked("lane over lane", "lane")).toEqual(["lane", "lane"]);
  });

  it("matches without regard to case but marks what the text actually says", () => {
    expect(marked("Fix The Lane", "the lane")).toEqual(["The Lane"]);
  });

  it("runs touching matches together instead of butting two marks up", () => {
    // Each mark is padded and pulled back by the same pixel, so two adjacent
    // ones overlap where they meet — and a translucent background drawn twice
    // there shows as a darker seam through the middle of one word.
    expect(splitOnQuery("off", "f")).toEqual([
      { text: "o", hit: false },
      { text: "ff", hit: true },
    ]);
    expect(splitOnQuery("aaaa", "aa")).toEqual([{ text: "aaaa", hit: true }]);
    expect(splitOnQuery("f-ff-f", "f")).toEqual([
      { text: "f", hit: true },
      { text: "-", hit: false },
      { text: "ff", hit: true },
      { text: "-", hit: false },
      { text: "f", hit: true },
    ]);
  });

  it("puts the text back together exactly, whatever it marked", () => {
    // The runs are rendered in order, so anything dropped or duplicated here
    // shows up as a corrupted commit message on the row.
    for (const [text, query] of [
      ["aaa", "a"],
      ["abcabc", "bc"],
      ["Fix lane; fix LANE", "fix"],
      ["", "a"],
    ] as const) {
      expect(rebuilt(text, query)).toBe(text);
    }
  });

  it("treats the query as literal text rather than a pattern", () => {
    // The graph's search is a substring test; a regex-flavoured query must not
    // start matching things the count in the toolbar does not count.
    expect(marked("a.b", "a.b")).toEqual(["a.b"]);
    expect(marked("axb", "a.b")).toEqual([]);
  });
});
