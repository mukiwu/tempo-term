import { truncateContents } from "./attachments";

/** Budget for the active-file context block — larger than a casual attachment
 * because it is the primary thing the user is looking at. */
export const ACTIVE_FILE_MAX_BYTES = 8000;

/**
 * Render the file the user is currently viewing as a context block for the
 * system prompt. Returns an empty string when there is no file or it is blank,
 * so the caller can omit it entirely. The content is truncated so a huge file
 * never blows up the prompt.
 */
export function buildActiveFileBlock(
  path: string | null,
  content: string,
): string {
  if (!path || content.trim().length === 0) {
    return "";
  }
  const body = truncateContents(content, ACTIVE_FILE_MAX_BYTES);
  return `The file the user is currently viewing (${path}):\n${body}`;
}

/** Default number of trailing terminal lines to keep as context. */
export const TERMINAL_CONTEXT_MAX_LINES = 200;

/**
 * Render the active terminal's scrollback as a context block for the system
 * prompt. Keeps only the last `maxLines` lines so a long session does not blow
 * up the prompt, and returns an empty string when there is nothing to show.
 */
export function buildTerminalBlock(
  raw: string,
  maxLines: number = TERMINAL_CONTEXT_MAX_LINES,
): string {
  const trimmed = raw.replace(/\s+$/u, "");
  if (trimmed.trim().length === 0) {
    return "";
  }
  const lines = trimmed.split("\n");
  const tail = lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
  return `Recent output from the user's active terminal:\n${tail.join("\n")}`;
}
