import { describe, expect, it } from "vitest";
import {
  SESSION_SEPARATOR,
  dropRestoredPrefix,
  serializeLogicalTail,
  trimScrollback,
  type BufferRow,
} from "./terminalHistory";

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

describe("dropRestoredPrefix", () => {
  it("drops the restored read-only block and keeps only this session's output", () => {
    const buffer = ["old line 1", "old line 2", SESSION_SEPARATOR, "live 1", "live 2"].join("\n");
    expect(dropRestoredPrefix(buffer, SESSION_SEPARATOR)).toBe("live 1\nlive 2");
  });

  it("returns the text unchanged when nothing was restored (no separator)", () => {
    expect(dropRestoredPrefix("live 1\nlive 2", SESSION_SEPARATOR)).toBe("live 1\nlive 2");
  });

  it("returns empty when the live shell has produced no output yet", () => {
    const buffer = ["old line 1", SESSION_SEPARATOR].join("\n");
    expect(dropRestoredPrefix(buffer, SESSION_SEPARATOR)).toBe("");
  });

  it("keeps all live output when the restored block was partially evicted by the buffer cap", () => {
    // xterm evicts oldest rows first once a long single session overflows its
    // scrollback. Some restored history rows are gone, but the separator still
    // marks the boundary, so every live line must survive. A count-based strip
    // would slice off live lines here; anchoring on the separator does not.
    const buffer = ["surviving old line", SESSION_SEPARATOR, "live 1", "live 2", "live 3"].join(
      "\n",
    );
    expect(dropRestoredPrefix(buffer, SESSION_SEPARATOR)).toBe("live 1\nlive 2\nlive 3");
  });

  it("returns the text unchanged when the whole restored block (and separator) was evicted", () => {
    // Massive single-session overflow scrolls the separator out entirely; the
    // buffer is then pure live output and must not be truncated.
    const buffer = ["live 1", "live 2", "live 3"].join("\n");
    expect(dropRestoredPrefix(buffer, SESSION_SEPARATOR)).toBe("live 1\nlive 2\nlive 3");
  });

  it("anchors on the first separator so live output that echoes it is never dropped", () => {
    const buffer = ["old 1", SESSION_SEPARATOR, "live 1", SESSION_SEPARATOR, "live 2"].join("\n");
    expect(dropRestoredPrefix(buffer, SESSION_SEPARATOR)).toBe(
      ["live 1", SESSION_SEPARATOR, "live 2"].join("\n"),
    );
  });

  it("does not multiply restored history across repeated reopen cycles", () => {
    // Simulate reopening a pane N times. Each cycle:
    //   1. restore: prepend the saved history + a "previous session" separator
    //   2. shell prints one fresh live line
    //   3. snapshot: serialize the whole buffer, then strip the restored prefix
    // The persisted file must stay a single session's worth of output, never an
    // ever-growing stack of duplicated history.
    let saved = "";
    for (let i = 0; i < 5; i += 1) {
      const restoredLines = saved === "" ? [] : [...saved.split("\n"), SESSION_SEPARATOR];
      const liveLine = `live ${i}`;
      const fullBuffer = [...restoredLines, liveLine].join("\n");
      saved = dropRestoredPrefix(fullBuffer, SESSION_SEPARATOR);
    }
    expect(saved).toBe("live 4");
    expect(saved.split("\n").filter((line) => line === SESSION_SEPARATOR)).toHaveLength(0);
  });
});

describe("serializeLogicalTail", () => {
  const WIDTH = 80;
  /** A logical line long enough to soft-wrap across three rows at WIDTH. */
  const wide = (label: string): string => `${label}:${"x".repeat(WIDTH * 2 + 10)}`;

  /** Split a logical line into WIDTH-wide rows; continuations carry isWrapped. */
  function wrapLine(text: string, width: number): BufferRow[] {
    if (text === "") {
      return [{ text: "", isWrapped: false }];
    }
    const rows: BufferRow[] = [];
    for (let i = 0; i < text.length; i += width) {
      rows.push({ text: text.slice(i, i + width), isWrapped: i > 0 });
    }
    return rows;
  }
  const rowsFor = (lines: string[], width = WIDTH): BufferRow[] =>
    lines.flatMap((line) => wrapLine(line, width));
  const getter = (rows: BufferRow[]) => (y: number) => rows[y] ?? null;

  /**
   * The pipeline the tail walk must stay equivalent to: serialize EVERY row into
   * logical lines (like serializeBufferText with no cap), then drop the restored
   * prefix and trim to `maxLines`.
   */
  function fullScan(rows: BufferRow[], maxLines: number): string {
    const lines: string[] = [];
    let current = "";
    for (let y = 0; y < rows.length; y++) {
      current += rows[y].text;
      const next = rows[y + 1];
      if (!next || !next.isWrapped) {
        lines.push(current.replace(/\s+$/u, ""));
        current = "";
      }
    }
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return trimScrollback(dropRestoredPrefix(lines.join("\n"), SESSION_SEPARATOR), maxLines);
  }

  it("matches a full scan for simple unwrapped output", () => {
    const rows = rowsFor(["a", "b", "c", "d"]);
    expect(serializeLogicalTail(getter(rows), rows.length, 3, SESSION_SEPARATOR)).toBe("b\nc\nd");
    expect(serializeLogicalTail(getter(rows), rows.length, 10, SESSION_SEPARATOR)).toBe(
      "a\nb\nc\nd",
    );
  });

  it("keeps MAX *logical* lines under soft-wrap, not fewer (the row-cap bug)", () => {
    // 20 logical lines, each soft-wrapping to 3 rows = 60 rows. A raw-row window
    // of 2*MAX would have held ~6-7 logical lines here; windowing by logical line
    // keeps exactly MAX, identical to a full-buffer scan.
    const logical = Array.from({ length: 20 }, (_, i) => wide(`L${i}`));
    const rows = rowsFor(logical);
    const result = serializeLogicalTail(getter(rows), rows.length, 10, SESSION_SEPARATOR);
    expect(result.split("\n")).toHaveLength(10);
    expect(result).toBe(fullScan(rows, 10));
    expect(result.split("\n")[0]).toBe(wide("L10"));
    expect(result.split("\n")[9]).toBe(wide("L19"));
  });

  it("drops the restored prefix + separator, keeping only live output (wrapped)", () => {
    const rows = [
      ...rowsFor([wide("old1"), wide("old2")]),
      { text: SESSION_SEPARATOR, isWrapped: false },
      ...rowsFor([wide("live1"), wide("live2")]),
    ];
    const result = serializeLogicalTail(getter(rows), rows.length, 10, SESSION_SEPARATOR);
    expect(result).toBe([wide("live1"), wide("live2")].join("\n"));
    expect(result).toBe(fullScan(rows, 10));
  });

  it("keeps the last MAX live lines when the separator is beyond the window", () => {
    const rows = [
      ...rowsFor([wide("old")]),
      { text: SESSION_SEPARATOR, isWrapped: false },
      ...rowsFor(Array.from({ length: 15 }, (_, i) => wide(`live${i}`))),
    ];
    const result = serializeLogicalTail(getter(rows), rows.length, 10, SESSION_SEPARATOR);
    const kept = result.split("\n");
    expect(kept).toHaveLength(10);
    expect(kept[0]).toBe(wide("live5"));
    expect(kept[9]).toBe(wide("live14"));
    expect(result).toBe(fullScan(rows, 10));
  });

  it("trims trailing blank lines without spending the line budget", () => {
    const rows = [
      ...rowsFor([wide("a"), wide("b"), wide("c")]),
      { text: "", isWrapped: false },
      { text: "   ", isWrapped: false },
    ];
    const result = serializeLogicalTail(getter(rows), rows.length, 2, SESSION_SEPARATOR);
    expect(result).toBe([wide("b"), wide("c")].join("\n"));
    expect(result).toBe(fullScan(rows, 2));
  });
});
