import { useTabsStore } from "@/stores/tabsStore";
import { writeToTerminal } from "@/modules/terminal/lib/terminalBus";
import type { SessionSummary } from "./sessionsBridge";
import { resumeCommand } from "./resumeCommand";
export { resumeCommand };

/**
 * One-click resume: reopen a historical session in a fresh terminal tab by
 * replaying the CLI's own resume command.
 *
 * Grounded against the real CLI before writing this (Task 13, step 1):
 * `codex resume --help` →
 *   "Usage: codex resume [OPTIONS] [SESSION_ID] [PROMPT]" — SESSION_ID is a
 *   positional UUID or session name, confirming `codex resume <id>`.
 * `claude --resume <id>` is documented Claude Code CLI usage.
 * Antigravity has no verified CLI resume flag, so it resolves to null —
 * callers hide (rows) or disable-with-tooltip (viewer header) the button.
 */

/**
 * Opens a new terminal tab at the session's project directory and replays
 * the agent's resume command into it. Mirrors the reopen-and-write pattern
 * in `terminalBus.runCommandInTerminal`: create the tab, read back its
 * `activeLeafId` from the store, then `writeToTerminal` — which queues the
 * write until the fresh PTY registers, so there's no startup race.
 * Returns false (no tab opened) when the agent has no resume command.
 */
export function resumeSession(s: SessionSummary): boolean {
  const cmd = resumeCommand(s.agent, s.id);
  if (cmd === null) {
    return false;
  }
  const tabId = useTabsStore.getState().newTerminalTab(s.project_cwd || undefined);
  const created = useTabsStore.getState().tabs.find((t) => t.id === tabId);
  if (!created || created.kind !== "terminal") {
    return false;
  }
  // Terminate with CR (`\r`) — the byte Enter sends. Windows' PSReadLine treats
  // LF as a `>>` continuation that never submits; `cmd` is newline-free (built
  // from a validated id), so a bare `\r` submits it on every platform.
  writeToTerminal(created.activeLeafId, `${cmd}\r`);
  return true;
}
