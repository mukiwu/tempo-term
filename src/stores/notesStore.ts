import { create } from "zustand";
import {
  fsCreateDir,
  fsCreateFile,
  fsDelete,
  fsReadDir,
  fsReadFile,
  fsRename,
  fsWriteFile,
} from "@/modules/explorer/lib/fsBridge";
import { fileNameForTitle, sanitizeName } from "@/modules/notes/lib/notesPaths";
import { type NotesNode, nodesFromEntries } from "@/modules/notes/lib/notesTree";

/**
 * Global notes backed by a user-chosen folder. The filesystem is the single
 * source of truth: notes are `.md` files, folders are real subdirectories, and
 * a note's identity is its absolute path. Sync is delegated to whatever the
 * user points the folder at (a cloud drive, a Git repo); this store never
 * manages sync, accounts, or a backend.
 */
interface NotesState {
  /** Folder backing the notes, or null before one is chosen. */
  rootPath: string | null;
  /** The current folder tree, rebuilt from disk on every mutation. */
  tree: NotesNode[];
  loading: boolean;
  error: string | null;

  setRoot: (path: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  readNote: (path: string) => Promise<string>;
  writeNote: (path: string, content: string) => Promise<void>;
  createNote: (dirPath: string) => Promise<string>;
  createFolder: (dirPath: string, name: string) => Promise<string>;
  renameNote: (path: string, newTitle: string) => Promise<string>;
  renameFolder: (path: string, newName: string) => Promise<string>;
  deleteNote: (path: string) => Promise<void>;
  moveNote: (path: string, targetDir: string) => Promise<string>;
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "" : path.slice(0, idx);
}

function baseName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? path : path.slice(idx + 1);
}

// Guard against unbounded recursion if the chosen folder contains a symlink
// cycle (cloud-drive folders sometimes do). Notes hierarchies are never deep.
const MAX_TREE_DEPTH = 32;

/** Recursively read a directory into a sorted notes tree. */
async function readTree(dir: string, depth = 0): Promise<NotesNode[]> {
  if (depth > MAX_TREE_DEPTH) {
    return [];
  }
  const entries = await fsReadDir(dir);
  const childrenByPath = new Map<string, NotesNode[]>();
  // Read subdirectories in parallel; deep trees would be slow read serially.
  await Promise.all(
    entries
      .filter((entry) => entry.is_dir)
      .map(async (entry) => {
        childrenByPath.set(entry.path, await readTree(entry.path, depth + 1));
      }),
  );
  return nodesFromEntries(entries, (folderPath) => childrenByPath.get(folderPath) ?? []);
}

/**
 * Pick a free name in a directory, comparing case-insensitively so it works on
 * case-insensitive filesystems (macOS, Windows) where `untitled.md` and
 * `Untitled.md` collide. `suffix` is appended to the base (e.g. `.md`).
 */
async function uniqueChildPath(
  dirPath: string,
  base: string,
  suffix: string,
): Promise<string> {
  const entries = await fsReadDir(dirPath);
  const existing = new Set(entries.map((e) => e.name.toLowerCase()));
  let name = `${base}${suffix}`;
  let n = 2;
  while (existing.has(name.toLowerCase())) {
    name = `${base} ${n}${suffix}`;
    n += 1;
  }
  return joinPath(dirPath, name);
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  rootPath: null,
  tree: [],
  loading: false,
  error: null,

  setRoot: async (path) => {
    set({ rootPath: path });
    await get().refresh();
  },

  refresh: async () => {
    const { rootPath } = get();
    if (!rootPath) {
      set({ tree: [], error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const tree = await readTree(rootPath);
      set({ tree, loading: false });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to read notes folder";
      set({ loading: false, error: message });
    }
  },

  readNote: (path) => fsReadFile(path),

  writeNote: (path, content) => fsWriteFile(path, content),

  createNote: async (dirPath) => {
    const path = await uniqueChildPath(dirPath, "Untitled", ".md");
    await fsCreateFile(path);
    await get().refresh();
    return path;
  },

  createFolder: async (dirPath, name) => {
    const path = await uniqueChildPath(dirPath, name, "");
    await fsCreateDir(path);
    await get().refresh();
    return path;
  },

  renameNote: async (path, newTitle) => {
    const newPath = joinPath(parentDir(path), fileNameForTitle(newTitle));
    if (newPath === path) {
      return path;
    }
    await fsRename(path, newPath);
    await get().refresh();
    return newPath;
  },

  renameFolder: async (path, newName) => {
    const newPath = joinPath(parentDir(path), sanitizeName(newName));
    if (newPath === path) {
      return path;
    }
    await fsRename(path, newPath);
    await get().refresh();
    return newPath;
  },

  deleteNote: async (path) => {
    await fsDelete(path);
    await get().refresh();
  },

  moveNote: async (path, targetDir) => {
    const newPath = joinPath(targetDir, baseName(path));
    if (newPath === path) {
      return path;
    }
    await fsRename(path, newPath);
    await get().refresh();
    return newPath;
  },
}));
