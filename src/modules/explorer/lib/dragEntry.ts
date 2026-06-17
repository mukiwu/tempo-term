/**
 * Drag state for dragging an explorer entry onto a pane. Tauri's webview makes
 * HTML5 dataTransfer unreliable, so the dragged entry is held module-side (the
 * same approach the notes drag-and-drop uses).
 */
export interface DraggedEntry {
  path: string;
  name: string;
  isDir: boolean;
}

let current: DraggedEntry | null = null;

export function setDraggedEntry(entry: DraggedEntry | null): void {
  current = entry;
}

export function getDraggedEntry(): DraggedEntry | null {
  return current;
}

/** Quote a path for a shell only when it contains characters that need it. */
export function shellQuotePath(path: string): string {
  if (/^[\w@%+=:,./-]+$/.test(path)) {
    return path;
  }
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/** A Markdown link `[name](path)` for dropping an entry into a note. */
export function markdownLink(name: string, path: string): string {
  return `[${name}](${path})`;
}

/** A file:// URL for showing a dropped file in the web preview. */
export function fileUrl(path: string): string {
  return `file://${path}`;
}
