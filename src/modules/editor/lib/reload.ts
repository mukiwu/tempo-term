interface BufferSnapshot {
  content: string;
  baseline: string;
}

/**
 * Whether an editor tab should re-read its file from disk when it (re)opens.
 *
 * Reading on every open lets external edits show up, but a buffer with unsaved
 * changes (content diverged from its baseline) must be kept so reopening the
 * tab never clobbers the user's work.
 */
export function shouldReloadFromDisk(buffer: BufferSnapshot | undefined): boolean {
  if (!buffer) {
    return true;
  }
  return buffer.content === buffer.baseline;
}

export type ManualReloadAction = "reload" | "confirm";

/**
 * What a user-initiated refresh should do. A clean (or not-yet-open) buffer
 * reloads straight from disk; a buffer with unsaved edits must confirm first so
 * the user's work is never silently discarded. This differs from the on-open
 * path (`shouldReloadFromDisk`), where a dirty buffer is silently kept rather
 * than prompting — a manual refresh is an explicit user action, so it asks.
 */
export function manualReloadAction(buffer: BufferSnapshot | undefined): ManualReloadAction {
  return shouldReloadFromDisk(buffer) ? "reload" : "confirm";
}
