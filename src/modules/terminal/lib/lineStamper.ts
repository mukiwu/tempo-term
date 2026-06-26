import type { Terminal } from "@xterm/xterm";
import type { LineTimestamps } from "./lineTimestamps";

export interface LineStamper {
  /** Begin stamping (call once output is live). */
  arm(): void;
  /** Stop stamping and detach. */
  dispose(): void;
}

/**
 * Record the time each buffer line is written. Driven by `onLineFeed` (fires
 * once per real new line, from `\n` or auto-wrap) plus `onWriteParsed` for the
 * trailing line that has no newline yet (e.g. a prompt). Each event stamps only
 * the current cursor line, first-write-wins, so a shell that moves the cursor
 * around to redraw its prompt (via `\r`, no line feed) can't scramble or skip
 * stamps the way cursor-delta tracking did. Inert until armed so restored
 * history keeps no timestamp.
 */
export function attachLineStamper(term: Terminal, stamps: LineTimestamps): LineStamper {
  let armed = false;
  const stampCursorLine = () => {
    if (!armed) {
      return;
    }
    const line = term.buffer.active.baseY + term.buffer.active.cursorY;
    stamps.stamp(line, line, Date.now());
  };
  const lineFeed = term.onLineFeed(stampCursorLine);
  const writeParsed = term.onWriteParsed(stampCursorLine);
  return {
    arm() {
      armed = true;
      stampCursorLine();
    },
    dispose() {
      lineFeed.dispose();
      writeParsed.dispose();
    },
  };
}
