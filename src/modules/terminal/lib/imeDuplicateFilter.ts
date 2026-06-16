/**
 * Works around an xterm.js CompositionHelper race: switching the input method
 * mid-composition can make the just-committed text get sent to the PTY twice
 * (see xtermjs/xterm.js#3196; VS Code's terminal shares the root cause).
 *
 * The filter watches composition commits and, only within a short window right
 * after one, drops a second identical payload. Outside that window every
 * keystroke passes through untouched, so ordinary typing is never altered.
 */

const GUARD_WINDOW_MS = 180;

export class ImeDuplicateFilter {
  private composedText = "";
  private guardUntil = 0;
  private lastForwarded = "";
  private lastForwardedAt = 0;

  /** Record that the IME just committed `text` at time `now` (ms). */
  noteCompositionEnd(text: string, now: number): void {
    this.composedText = text;
    this.guardUntil = now + GUARD_WINDOW_MS;
    // Reset so the first delivery of the composed text is always forwarded.
    this.lastForwarded = "";
    this.lastForwardedAt = 0;
  }

  /** Decide whether a piece of terminal input should be forwarded to the PTY. */
  shouldForward(data: string, now: number): boolean {
    const withinGuard = now <= this.guardUntil;
    const isComposedText = data !== "" && data === this.composedText;
    const isImmediateRepeat =
      this.lastForwarded === data && now - this.lastForwardedAt < GUARD_WINDOW_MS;

    if (withinGuard && isComposedText && isImmediateRepeat) {
      return false;
    }

    this.lastForwarded = data;
    this.lastForwardedAt = now;
    return true;
  }
}
