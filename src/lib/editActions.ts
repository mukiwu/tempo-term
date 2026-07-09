import { focusedTerminalOps } from "@/modules/terminal/lib/terminalBus";

/**
 * The menu bar / Edit menu's Copy action. Prefers the focused terminal's
 * current selection (matching what a terminal user expects Cmd/Ctrl+C to
 * copy); falls back to the browser's own copy command for everything else
 * (editor selections, text inputs) since those already respond to it.
 */
export async function menuCopy(): Promise<void> {
  const selection = focusedTerminalOps()?.getSelection();
  if (selection) {
    await navigator.clipboard.writeText(selection);
    return;
  }
  document.execCommand("copy");
}

/**
 * The menu bar / Edit menu's Paste action. Pastes clipboard text into the
 * FOCUSED terminal leaf's own ops (never `insertIntoActiveTerminal`, which
 * resolves by the tab's creation `kind` — a launcher tab that later grew a
 * terminal pane via `setPaneContent` never becomes `kind: "terminal"`, so
 * that resolver can silently target a different tab). Falls back to
 * inserting at the current selection everywhere else.
 */
export async function menuPaste(): Promise<void> {
  const text = await navigator.clipboard.readText();
  if (!text) return;
  const ops = focusedTerminalOps();
  if (ops) {
    ops.paste(text);
    return;
  }
  document.execCommand("insertText", false, text);
}

/** The menu bar / Edit menu's Select All action. */
export function menuSelectAll(): void {
  const ops = focusedTerminalOps();
  if (ops) {
    ops.selectAll();
    return;
  }
  document.execCommand("selectAll");
}
