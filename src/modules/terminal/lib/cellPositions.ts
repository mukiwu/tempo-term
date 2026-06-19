/**
 * Map string indices in a terminal line back to xterm buffer cell columns.
 *
 * xterm positions links by display column, not by JavaScript string length:
 * a wide (CJK / fullwidth) glyph occupies two columns while counting as one
 * code unit. Walking the buffer's own cells keeps our column math in sync with
 * however xterm measured them, so link underlines and hit regions land on the
 * actual text even when wide characters sit earlier on the line.
 */

export interface TerminalCell {
  /** The cell's text. Empty for never-written cells and wide-char spacers. */
  chars: string;
  /** Display width in columns: 1 (normal), 2 (wide), or 0 (wide-char spacer). */
  width: number;
}

export interface TerminalRow {
  /** 1-based buffer line number, as used by xterm link ranges. */
  y: number;
  cells: TerminalCell[];
}

export interface CellSpan {
  /** 1-based column where the character starts. */
  startX: number;
  /** 1-based column of the last cell the character occupies. */
  endX: number;
  /** 1-based buffer line number. */
  y: number;
}

export interface CellPositions {
  /** Text rebuilt from the cells, matching xterm's translateToString(false). */
  text: string;
  /** Cell span for each UTF-16 code unit in `text`. */
  spans: CellSpan[];
}

export function buildCellPositions(rows: TerminalRow[]): CellPositions {
  let text = "";
  const spans: CellSpan[] = [];

  for (const row of rows) {
    for (let col = 0; col < row.cells.length; col += 1) {
      const cell = row.cells[col];
      // The spacer column after a wide glyph carries no text of its own.
      if (cell.width === 0) {
        continue;
      }
      // Never-written cells translate to a single space, like xterm does.
      const chars = cell.chars === "" ? " " : cell.chars;
      const startX = col + 1;
      const endX = startX + Math.max(cell.width, 1) - 1;
      for (let k = 0; k < chars.length; k += 1) {
        spans.push({ startX, endX, y: row.y });
      }
      text += chars;
    }
  }

  return { text, spans };
}
