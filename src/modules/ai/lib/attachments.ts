import { redactSecrets } from "./redact";

/** A file the user attached to the assistant's context. */
export interface AttachedFile {
  path: string;
  contents: string;
}

/** Files larger than this are truncated so the prompt stays a sane size. */
export const ATTACHMENT_MAX_BYTES = 4096;

/**
 * Clamp a file's contents to `maxBytes`, appending a marker when it was cut so
 * the model knows the tail is missing. Length is measured in characters, which
 * is a close-enough proxy for bytes for the budgeting we need here.
 */
export function truncateContents(
  contents: string,
  maxBytes: number = ATTACHMENT_MAX_BYTES,
): string {
  if (contents.length <= maxBytes) {
    return contents;
  }
  return `${contents.slice(0, maxBytes)}\n…[truncated]`;
}

/**
 * Render attached files as a single context block to append to the system
 * prompt. Returns an empty string when nothing is attached so the caller can
 * skip it entirely.
 */
export function buildAttachmentsBlock(files: AttachedFile[]): string {
  if (files.length === 0) {
    return "";
  }
  const sections = files.map((file) => {
    const body = redactSecrets(truncateContents(file.contents));
    return `--- ${file.path} ---\n${body}`;
  });
  return ["The user attached these files for reference:", ...sections].join("\n\n");
}
