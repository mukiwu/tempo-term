import { describe, expect, it } from "vitest";
import { buildCellPositions, type TerminalRow } from "./cellPositions";

/** Build a row of single-width ASCII cells from a plain string. */
function asciiRow(y: number, text: string): TerminalRow {
  return {
    y,
    cells: [...text].map((ch) => ({ chars: ch, width: 1 })),
  };
}

describe("buildCellPositions", () => {
  it("maps an ASCII string index to the same 1-based column", () => {
    const { text, spans } = buildCellPositions([asciiRow(7, "abc")]);
    expect(text).toBe("abc");
    expect(spans[0]).toEqual({ startX: 1, endX: 1, y: 7 });
    expect(spans[2]).toEqual({ startX: 3, endX: 3, y: 7 });
  });

  it("accounts for the two columns a wide glyph occupies", () => {
    // xterm stores a wide glyph as a width-2 cell followed by a width-0 spacer.
    const row: TerminalRow = {
      y: 1,
      cells: [
        { chars: "文", width: 2 },
        { chars: "", width: 0 },
        { chars: "a", width: 1 },
      ],
    };
    const { text, spans } = buildCellPositions([row]);
    expect(text).toBe("文a");
    // The wide glyph spans columns 1-2...
    expect(spans[0]).toEqual({ startX: 1, endX: 2, y: 1 });
    // ...so the ASCII char after it sits at column 3, not 2.
    expect(spans[1]).toEqual({ startX: 3, endX: 3, y: 1 });
  });

  it("continues onto a wrapped row with its own column origin", () => {
    const { text, spans } = buildCellPositions([
      asciiRow(4, "ab"),
      asciiRow(5, "cd"),
    ]);
    expect(text).toBe("abcd");
    // First char of the second row restarts at column 1 on line 5.
    expect(spans[2]).toEqual({ startX: 1, endX: 1, y: 5 });
    expect(spans[3]).toEqual({ startX: 2, endX: 2, y: 5 });
  });
});
