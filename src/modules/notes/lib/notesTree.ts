/**
 * Build the notes tree from raw directory listings. The filesystem is the
 * single source of truth: markdown files become notes, subdirectories become
 * folders, everything else is ignored. Sorting mirrors a file explorer
 * (folders first, then by name). Recursion is injected so this stays pure and
 * testable without touching the filesystem.
 */
import type { DirEntry } from "@/modules/explorer/lib/fsBridge";
import { isConflictCopy, titleFromFilename } from "./notesPaths";

export interface NoteNode {
  kind: "note";
  name: string;
  title: string;
  path: string;
  isConflict: boolean;
}

export interface FolderNode {
  kind: "folder";
  name: string;
  path: string;
  children: NotesNode[];
}

export type NotesNode = NoteNode | FolderNode;

const MD_FILE = /\.md$/i;

/** True for a non-directory entry whose name ends in `.md`. */
export function isMarkdown(entry: DirEntry): boolean {
  return !entry.is_dir && MD_FILE.test(entry.name);
}

/** Folders first, then notes; each group sorted case-insensitively by name. */
export function sortNodes(nodes: NotesNode[]): NotesNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/**
 * Map one directory level into sorted nodes. Folders are recursed via
 * `childrenOf`; non-markdown files are dropped.
 */
export function nodesFromEntries(
  entries: DirEntry[],
  childrenOf: (folderPath: string) => NotesNode[],
): NotesNode[] {
  const nodes: NotesNode[] = [];
  for (const entry of entries) {
    if (entry.is_dir) {
      nodes.push({
        kind: "folder",
        name: entry.name,
        path: entry.path,
        children: childrenOf(entry.path),
      });
    } else if (isMarkdown(entry)) {
      nodes.push({
        kind: "note",
        name: entry.name,
        title: titleFromFilename(entry.name),
        path: entry.path,
        isConflict: isConflictCopy(entry.name),
      });
    }
  }
  return sortNodes(nodes);
}
