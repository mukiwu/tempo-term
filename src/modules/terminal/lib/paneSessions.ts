import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import type { PaneContent } from "./terminalLayout";

/**
 * Runtime map of pane leaf id → live local pty id, kept by TerminalView as
 * sessions open and close. Deliberately NOT part of tabsStore: the ids are
 * per-launch runtime state, and the persisted pane shape stays untouched (a
 * pending upstream PR reworks that shape for session recovery).
 */
const ptyByLeaf = new Map<string, number>();

export function registerPaneSession(leafId: string, ptyId: number): void {
  ptyByLeaf.set(leafId, ptyId);
}

export function unregisterPaneSession(leafId: string): void {
  ptyByLeaf.delete(leafId);
}

interface PaneLike {
  id: string;
  content: PaneContent;
}

/**
 * Would closing these panes interrupt running work? Mirrors the window-close
 * guard's rules (#376): an ssh pane always counts (its remote foreground
 * cannot be probed), a local terminal counts when the backend reports its
 * shell busy, and everything else — editors, previews, panes whose pty is not
 * open yet — never blocks a close. Honors the same user setting as the
 * window-level confirmation.
 *
 * Synchronous whenever it can decide without the backend, so the common
 * closes (editors, launchers, idle registries) stay one synchronous action —
 * a Promise comes back only when a live local pty actually has to be asked.
 */
export function panesWouldInterrupt(panes: PaneLike[]): boolean | Promise<boolean> {
  if (!useSettingsStore.getState().confirmCloseWithRunningTerminals) {
    return false;
  }
  const terminals = panes.filter((p) => p.content.kind === "terminal");
  if (terminals.some((p) => p.content.kind === "terminal" && p.content.ssh)) {
    return true;
  }
  const ids = terminals
    .map((p) => ptyByLeaf.get(p.id))
    .filter((id): id is number => id !== undefined);
  if (ids.length === 0) {
    return false;
  }
  return invoke<boolean>("pty_sessions_busy", { ids }).catch(() => false);
}

/** Run `close` immediately or after confirmation, per panesWouldInterrupt. */
export function guardPaneClose(
  panes: PaneLike[],
  close: () => void,
  ask: () => void,
): void {
  const verdict = panesWouldInterrupt(panes);
  if (verdict === true) {
    ask();
    return;
  }
  if (verdict === false) {
    close();
    return;
  }
  void verdict.then((busy) => (busy ? ask() : close()));
}
