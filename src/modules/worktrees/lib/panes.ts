import type { PaneContent } from "@/modules/terminal/lib/terminalLayout";

/**
 * Where a pane's shell sits **on this machine**, or null when that question has
 * no local answer.
 *
 * Shared by everything that asks "which panes belong to this worktree", so the
 * two rules below are stated once:
 *
 * - An SSH pane is a terminal like any other as far as the pane tree is
 *   concerned — `ssh` is just a flag on the same content — but its shell runs on
 *   a remote host. It has no local directory, whatever path it reports. Left in,
 *   it would lend a remote shell to a local worktree: it inherits `tab.cwd` when
 *   it has none of its own, and `openFromSidebar` puts SSH panes into whatever
 *   tab is active — including one already sitting in a worktree.
 * - A pane spawned moments ago has not reported its cwd yet, and only the tab's
 *   starting dir knows where it went.
 */
export function localTerminalCwd(
  content: PaneContent | undefined,
  tabCwd: string | undefined,
): string | null {
  if (content?.kind !== "terminal" || content.ssh) {
    return null;
  }
  return content.cwd || tabCwd || null;
}
