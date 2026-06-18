/**
 * Map a key event to the byte sequence a standard terminal would send, matching
 * how common terminals wire up editing shortcuts so muscle memory carries over
 * from other terminals:
 *
 *   Shift+Enter        → ESC CR         newline without submitting
 *   Cmd+Left/Right     → Ctrl-A/Ctrl-E  line start / end          (macOS)
 *   Alt+Left/Right     → ESC-b/ESC-f    word back / forward
 *   Cmd+Backspace      → Ctrl-U         delete to line start      (macOS)
 *   Option+Backspace   → Ctrl-W         delete word backward      (macOS)
 *   Ctrl+Backspace     → Ctrl-W         delete word backward      (other OS)
 *
 * Ctrl+Arrow is deliberately left to the shell (xterm sends the standard
 * CSI 1;5 sequence). Returns null when the event should fall through to xterm's
 * default handling.
 */
export interface NavKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function terminalKeySequence(event: NavKeyEvent, isMac: boolean): string | null {
  const { key, ctrlKey, metaKey, altKey, shiftKey } = event;

  // Shift+Enter → ESC CR, the same bytes macOS Option+Enter sends. Claude Code
  // and similar CLIs treat that as "insert a newline" rather than submit. This
  // matches common terminal behavior. The caller MUST preventDefault on
  // this key, otherwise xterm's hidden textarea also emits a bare CR and the
  // line gets submitted anyway.
  if (key === "Enter" && shiftKey && !ctrlKey && !metaKey && !altKey) {
    return "\x1b\r";
  }

  // Cmd+K → kill to end of line (Ctrl-K). At the line start this clears the
  // whole line. Ctrl+K already does this through the shell; this mirrors it
  // onto the Cmd many macOS users reach for.
  if (isMac && metaKey && !ctrlKey && !altKey && !shiftKey && (key === "k" || key === "K")) {
    return "\x0b";
  }

  // Deletion shortcuts
  if (key === "Backspace") {
    if (isMac && metaKey && !ctrlKey && !altKey) {
      return "\x15"; // Cmd+Backspace → delete to line start
    }
    if (isMac && altKey && !ctrlKey && !metaKey) {
      return "\x17"; // Option+Backspace → delete word backward
    }
    if (!isMac && ctrlKey && !metaKey && !altKey) {
      return "\x17"; // Ctrl+Backspace → delete word backward
    }
    return null;
  }

  // Navigation below only fires without Shift held.
  if (shiftKey) {
    return null;
  }
  // Cmd+Arrow → line start / end (macOS)
  if (isMac && metaKey && !ctrlKey && !altKey) {
    if (key === "ArrowLeft") return "\x01";
    if (key === "ArrowRight") return "\x05";
  }
  // Alt+Arrow → word back / forward
  if (altKey && !ctrlKey && !metaKey) {
    if (key === "ArrowLeft") return "\x1bb";
    if (key === "ArrowRight") return "\x1bf";
  }
  return null;
}
