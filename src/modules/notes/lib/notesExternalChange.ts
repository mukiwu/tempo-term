/**
 * Decide how an open note should react when the notes folder reports a
 * filesystem change. Kept pure so the policy is unit-testable without the
 * watcher or the editor.
 *
 * - `ignore`: the change does not touch this note, or it is the echo of our
 *   own recent debounced write.
 * - `reload`: the file changed on disk and there are no unsaved local edits, so
 *   we can safely show the disk version.
 * - `prompt`: the file changed on disk but there are unsaved local edits, so the
 *   user must choose between the disk version and their own.
 */
export type ExternalChangeAction = "ignore" | "reload" | "prompt";

export interface ExternalChangeInput {
  /** Absolute path of the note currently open in the tab. */
  notePath: string;
  /** Absolute paths reported as changed by the watcher. */
  changedPaths: string[];
  /** Whether the editor has edits not yet written to disk. */
  dirty: boolean;
  /** The last write this tab made itself, used to ignore its own echo. */
  selfWrite: { path: string; at: number } | null;
  /** Current timestamp (ms). */
  now: number;
  /** How long after a self-write an event is still treated as our own echo. */
  selfWriteWindowMs: number;
}

export function decideExternalChange(input: ExternalChangeInput): ExternalChangeAction {
  const { notePath, changedPaths, dirty, selfWrite, now, selfWriteWindowMs } = input;
  if (!changedPaths.includes(notePath)) {
    return "ignore";
  }
  if (
    selfWrite &&
    selfWrite.path === notePath &&
    now - selfWrite.at < selfWriteWindowMs
  ) {
    return "ignore";
  }
  return dirty ? "prompt" : "reload";
}
