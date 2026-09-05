/** A folder in a file tree built from a flat list of paths. */
export interface TreeFolderNode<T> {
  kind: "folder";
  name: string;
  /** Full path from the list root, e.g. "dist/aaa". */
  path: string;
  children: TreeNode<T>[];
}

/** A file leaf in a file tree. `file` is the original item, untouched. */
export interface TreeFileNode<T> {
  kind: "file";
  name: string;
  path: string;
  file: T;
}

export type TreeNode<T> = TreeFolderNode<T> | TreeFileNode<T>;

interface MutableFolder<T> {
  kind: "folder";
  name: string;
  path: string;
  // Folders and files are tracked in separate maps (not one map keyed by
  // name) so a file and a folder that happen to share a name — e.g. a
  // "config" file replaced by a "config/" directory in the same uncommitted
  // change — don't overwrite each other and silently drop one of the two.
  folders: Map<string, MutableFolder<T>>;
  files: Map<string, TreeFileNode<T>>;
}

/**
 * Builds a real nested tree from a flat list of paths: every ancestor
 * directory becomes its own parent node, so "dist/aaa/x.ts" and
 * "dist/bbb/y.ts" nest as dist → {aaa → x.ts, bbb → y.ts} instead of
 * "dist/aaa" and "dist/bbb" becoming two unrelated top-level groups.
 */
export function buildFileTree<T extends { path: string }>(files: T[]): TreeNode<T>[] {
  const root: MutableFolder<T> = {
    kind: "folder",
    name: "",
    path: "",
    folders: new Map(),
    files: new Map(),
  };

  function ensureFolder(parent: MutableFolder<T>, name: string, path: string): MutableFolder<T> {
    const existing = parent.folders.get(name);
    if (existing) {
      return existing;
    }
    const folder: MutableFolder<T> = { kind: "folder", name, path, folders: new Map(), files: new Map() };
    parent.folders.set(name, folder);
    return folder;
  }

  for (const file of files) {
    // git reports an untracked directory as a single entry ending in "/";
    // strip it so the entry becomes a leaf of its parent instead of an empty
    // folder node with the same name.
    const normalized = file.path.endsWith("/") ? file.path.slice(0, -1) : file.path;
    const segments = normalized.split("/").filter(Boolean);
    let cursor = root;
    let builtPath = "";
    for (let i = 0; i < segments.length - 1; i++) {
      builtPath = builtPath ? `${builtPath}/${segments[i]}` : segments[i];
      cursor = ensureFolder(cursor, segments[i], builtPath);
    }
    const fileName = segments[segments.length - 1] ?? normalized;
    cursor.files.set(fileName, { kind: "file", name: fileName, path: normalized, file });
  }

  function toSortedArray(folder: MutableFolder<T>): TreeNode<T>[] {
    const folderNodes: TreeNode<T>[] = Array.from(folder.folders.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => ({ kind: "folder", name: f.name, path: f.path, children: toSortedArray(f) }));
    const fileNodes: TreeNode<T>[] = Array.from(folder.files.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return [...folderNodes, ...fileNodes];
  }

  return toSortedArray(root);
}

/**
 * The tree's files in the order it draws them: at every level the folders
 * first, each alphabetical, then the files. Used where a flat list has to
 * stack in the same order the tree beside it is read in.
 */
export function flattenFileTree<T>(nodes: readonly TreeNode<T>[]): T[] {
  const files: T[] = [];
  for (const node of nodes) {
    if (node.kind === "folder") {
      files.push(...flattenFileTree(node.children));
    } else {
      files.push(node.file);
    }
  }
  return files;
}

/** Every file under a folder, recursing through all descendant folders —
 * the basis for "act on this whole subtree" folder actions. Reads the tree
 * data structure, not rendered DOM, so it is unaffected by collapse state. */
export function collectDescendantFiles<T>(folder: TreeFolderNode<T>): T[] {
  const result: T[] = [];
  for (const child of folder.children) {
    if (child.kind === "file") {
      result.push(child.file);
    } else {
      result.push(...collectDescendantFiles(child));
    }
  }
  return result;
}
