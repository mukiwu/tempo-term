/**
 * Tracks leaf ids that were opened as fresh SSH sessions THIS app session
 * (not restored from persisted state). Module-level — lives only in memory,
 * so it is empty after every app relaunch.
 *
 * openSshTab adds a leaf id when the user actively opens a connection.
 * TerminalView consumes (checks + deletes) the id on mount: present → auto-connect,
 * absent → show the "Disconnected — click to Reconnect" state.
 */
const freshLeaves = new Set<string>();

/** Mark a leaf as freshly user-opened so TerminalView auto-connects it. */
export function markFreshSshLeaf(leafId: string): void {
  freshLeaves.add(leafId);
}

/**
 * One-shot check-and-consume. Returns true and removes the id when the leaf
 * was opened fresh this session; returns false for restored panes.
 */
export function consumeFreshSshLeaf(leafId: string): boolean {
  if (freshLeaves.has(leafId)) {
    freshLeaves.delete(leafId);
    return true;
  }
  return false;
}
