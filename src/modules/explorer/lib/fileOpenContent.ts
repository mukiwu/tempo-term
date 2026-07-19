import { fileUrl } from "./dragEntry";
import { isRemoteUri } from "@/modules/ssh/lib/remotePath";
import type { PaneContent } from "@/modules/terminal/lib/terminalLayout";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);

/** Lowercased extension without the dot, or "" when there is none. */
export function extOf(path: string): string {
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(extOf(path));
}

export function isPdfPath(path: string): boolean {
  return extOf(path) === "pdf";
}

/**
 * Map a LOCAL file path to the pane content that should render it: images get
 * the in-app media viewer, PDFs the native preview webview, everything else
 * the text editor. Remote (ssh://) paths are never remapped — the asset
 * protocol only serves local files, so SFTP images/PDFs keep opening in the
 * editor.
 */
export function fileOpenContent(path: string): PaneContent {
  if (isRemoteUri(path)) {
    return { kind: "editor", path };
  }
  if (isImagePath(path)) {
    return { kind: "media", path };
  }
  if (isPdfPath(path)) {
    return { kind: "preview", url: fileUrl(path) };
  }
  return { kind: "editor", path };
}
