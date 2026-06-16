import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * A global, persistent notes library (Warp Drive's notebooks, simplified): the
 * user can jot markdown notes any time, organised into folders. Stored locally
 * so it survives restarts and is independent of the open workspace.
 */
export interface NoteFolder {
  id: string;
  name: string;
}

export interface Note {
  id: string;
  folderId: string | null;
  title: string;
  content: string;
  updatedAt: number;
}

interface NotesState {
  folders: NoteFolder[];
  notes: Note[];
  createFolder: (name?: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  createNote: (folderId?: string | null) => string;
  updateNote: (id: string, patch: Partial<Pick<Note, "title" | "content">>) => void;
  deleteNote: (id: string) => void;
  noteById: (id: string) => Note | undefined;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function now(): number {
  // App runtime only (not a workflow script), so Date is available.
  return Date.now();
}

export const NOTES_STORAGE_KEY = "tempoterm-notes";

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => ({
      folders: [],
      notes: [],

      createFolder: (name) => {
        const id = nextId("folder");
        set((state) => ({
          folders: [
            ...state.folders,
            { id, name: name ?? `Folder ${state.folders.length + 1}` },
          ],
        }));
        return id;
      },

      renameFolder: (id, name) =>
        set((state) => ({
          folders: state.folders.map((f) => (f.id === id ? { ...f, name } : f)),
        })),

      deleteFolder: (id) =>
        set((state) => ({
          folders: state.folders.filter((f) => f.id !== id),
          notes: state.notes.filter((n) => n.folderId !== id),
        })),

      createNote: (folderId = null) => {
        const id = nextId("note");
        const note: Note = {
          id,
          folderId,
          title: "Untitled",
          content: "",
          updatedAt: now(),
        };
        set((state) => ({ notes: [...state.notes, note] }));
        return id;
      },

      updateNote: (id, patch) =>
        set((state) => ({
          notes: state.notes.map((n) =>
            n.id === id ? { ...n, ...patch, updatedAt: now() } : n,
          ),
        })),

      deleteNote: (id) =>
        set((state) => ({ notes: state.notes.filter((n) => n.id !== id) })),

      noteById: (id) => get().notes.find((n) => n.id === id),
    }),
    {
      name: NOTES_STORAGE_KEY,
      partialize: (state) => ({ folders: state.folders, notes: state.notes }),
    },
  ),
);
