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

/** Physical-key event shape used to detect app-level shortcuts (uses `code`). */
export interface AppShortcutEvent {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * True for the global shortcuts the app handles at the window level, which the
 * terminal must let bubble to the window handler instead of typing into the
 * shell. `code` is used over `key` so it still matches when a modifier rewrites
 * the character (macOS ⌥1 yields "¡").
 *
 * Cross-platform: ⌘/Ctrl+1-9 switch tab, ⌥1-9 switch sidebar, ⌘/Ctrl +/-/0 zoom,
 * ⌘/Ctrl+` cycle pane.
 *
 * Windows-only: the app's other shortcuts use Ctrl as their modifier (macOS uses
 * Cmd). Ctrl+<letter> combos are ALSO terminal control codes — Ctrl+T sends ^T,
 * Ctrl+D sends EOF, Ctrl+W deletes a word — so when a terminal pane is focused
 * xterm would send them to the shell and the app shortcut would never fire.
 * Matching the Shortcuts settings list, let the app win here so the shortcuts
 * behave the same whether or not a terminal has focus. macOS routes these
 * through Cmd, which never collides with the terminal, so this branch is gated
 * to Windows. Ctrl+L is deliberately excluded so a focused terminal keeps its
 * clear-screen (Open Location applies only to a preview pane, never a terminal).
 */
export function isAppShortcut(event: AppShortcutEvent, isWindows: boolean): boolean {
  // The app's shortcut modifier is Cmd (metaKey) on macOS and Ctrl on Windows.
  // On Windows metaKey is the Windows key, so a Win+<key> system combo must NOT
  // be treated as an app shortcut — require Ctrl and exclude Win there.
  const cmd = isWindows ? event.ctrlKey && !event.metaKey : event.metaKey || event.ctrlKey;
  if (/^(?:Digit|Numpad)[1-9]$/.test(event.code)) {
    const switchTab = cmd && !event.shiftKey && !event.altKey;
    const switchSidebar = event.altKey && !event.metaKey && !event.ctrlKey;
    return switchTab || switchSidebar;
  }
  if (/^(?:Equal|Minus|Digit0|NumpadAdd|NumpadSubtract|Numpad0|Backquote)$/.test(event.code)) {
    return cmd && !event.altKey;
  }
  if (isWindows && cmd && !event.altKey) {
    switch (event.code) {
      // Close Tab / Close Window, New Tab / New Terminal Tab, Split Right / Split
      // Down — the Shift variants are valid app shortcuts too, so match any Shift.
      case "KeyW":
      case "KeyT":
      case "KeyD":
        return true;
      // Find Files, Toggle Sidebar, New Window, Settings — no Shift variant.
      case "KeyP":
      case "KeyB":
      case "KeyN":
      case "Comma":
        return !event.shiftKey;
      default:
        return false;
    }
  }
  return false;
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
