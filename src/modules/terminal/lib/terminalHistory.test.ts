import { describe, expect, it } from "vitest";
import { trimScrollback } from "./terminalHistory";

describe("trimScrollback", () => {
  it("keeps only the last N lines when the text is longer", () => {
    const text = ["a", "b", "c", "d", "e"].join("\n");
    expect(trimScrollback(text, 3)).toBe("c\nd\ne");
  });

  it("returns the text unchanged when it has at most N lines", () => {
    expect(trimScrollback("a\nb", 5)).toBe("a\nb");
    expect(trimScrollback("", 5)).toBe("");
  });
});
