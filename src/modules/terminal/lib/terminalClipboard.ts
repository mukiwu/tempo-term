import { invoke } from "@tauri-apps/api/core";
import { IS_WINDOWS } from "@/lib/platform";

export function terminalClipboardPaths(): Promise<string[]> {
  return invoke<string[]>("terminal_clipboard_paths");
}

export function terminalClipboardImagePaths(): Promise<string[]> {
  return invoke<string[]>("terminal_clipboard_image_paths");
}

export function terminalClipboardText(): Promise<string> {
  return invoke<string>("terminal_clipboard_text");
}

export function prepareClipboardImageAttachment(path: string): Promise<void> {
  return invoke("terminal_prepare_clipboard_image_attachment", { path });
}

export async function saveDroppedImage(file: File): Promise<string> {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return invoke<string>("terminal_save_dropped_image", {
    name: file.name || undefined,
    mime: file.type || undefined,
    bytes,
  });
}

export function isImageAttachmentCli(command: string | null | undefined): boolean {
  if (!command) {
    return false;
  }
  const normalized = command.toLowerCase();
  return ["claude", "codex", "gemini"].some((name) => normalized.includes(name));
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path);
}

export function shouldAttachImage(command: string | null | undefined, paths: string[]): boolean {
  return isImageAttachmentCli(command) && paths.length === 1 && isImagePath(paths[0]);
}

export function formatImagePathsForTerminal(paths: string[]): string {
  return formatPathsForTerminal(paths);
}

export function formatPathsForTerminal(paths: string[]): string {
  return paths.length > 0 ? `${paths.map((path) => shellQuotePath(path)).join(" ")} ` : "";
}

export function shellQuotePath(path: string, isWindows: boolean = IS_WINDOWS): string {
  if (isWindows) {
    // Windows paths use backslashes and a drive colon, and may run under cmd,
    // PowerShell or git-bash. Double quotes are the one form all three accept,
    // and filenames cannot contain '"', so wrapping is always safe. Leave a
    // path that needs no quoting (no spaces/special chars) bare. A comma is NOT
    // safe bare: PowerShell parses it as the array operator, so it forces quoting.
    if (/^[A-Za-z0-9_.:@%+=\\/-]+$/.test(path)) {
      return path;
    }
    return `"${path}"`;
  }
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(path)) {
    return path;
  }
  return `'${path.replace(/'/g, "'\\''")}'`;
}

export type PasteAction =
  | { kind: "text"; text: string }
  | { kind: "attach-image"; path: string }
  | { kind: "paste-paths"; paths: string[] }
  | { kind: "control" }
  | { kind: "none" };

interface PasteInput {
  shortcut: "ctrl" | "cmd";
  clipboardText: string;
  filePaths: string[];
  imagePaths: string[];
  foregroundCommand: string | null;
}

/**
 * Decide what a terminal paste should do, in priority order:
 *
 * 1. Clipboard text wins and is pasted verbatim — no path detection, no shell
 *    quoting — so an ordinary copy (or a path-looking string) lands exactly as
 *    copied. This ordering is what keeps plain text from being mis-quoted.
 * 2. With no text, a copied image handed to an image-aware CLI is attached.
 * 3. Otherwise a genuine file reference (or a screenshot's temp path) is pasted
 *    as a shell-quoted path.
 * 4. A bare Ctrl+V with nothing to paste falls back to the raw control byte.
 */
export function resolvePasteAction(input: PasteInput): PasteAction {
  if (input.clipboardText) {
    return { kind: "text", text: input.clipboardText };
  }
  if (shouldAttachImage(input.foregroundCommand, input.filePaths)) {
    return { kind: "attach-image", path: input.filePaths[0] };
  }
  if (shouldAttachImage(input.foregroundCommand, input.imagePaths)) {
    return { kind: "attach-image", path: input.imagePaths[0] };
  }
  if (input.filePaths.length > 0) {
    return { kind: "paste-paths", paths: input.filePaths };
  }
  if (input.imagePaths.length > 0) {
    return { kind: "paste-paths", paths: input.imagePaths };
  }
  return input.shortcut === "ctrl" ? { kind: "control" } : { kind: "none" };
}
