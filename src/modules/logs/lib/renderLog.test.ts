import { describe, expect, it } from "vitest";
import { collapseBlankRuns } from "./renderLog";

describe("collapseBlankRuns", () => {
  it("trims leading/trailing blanks and caps interior blank runs at 2", () => {
    const input = ["", "", "a", "", "", "", "b", "", ""];
    expect(collapseBlankRuns(input)).toEqual(["a", "", "", "b"]);
  });

  it("returns an empty array for all-blank input", () => {
    expect(collapseBlankRuns(["", "", ""])).toEqual([]);
  });
});
