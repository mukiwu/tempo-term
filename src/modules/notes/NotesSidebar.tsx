import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FolderPlus,
  FileText,
  Folder,
  Trash2,
} from "lucide-react";
import { useNotesStore, type Note } from "@/stores/notesStore";
import { useTabsStore } from "@/stores/tabsStore";

// Tracks the note being dragged (dataTransfer is unreliable in the webview).
let draggedNoteId: string | null = null;

function NoteRow({ note, depth }: { note: Note; depth: number }) {
  const { t } = useTranslation("notes");
  const openNoteTab = useTabsStore((s) => s.openNoteTab);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const reorderNote = useNotesStore((s) => s.reorderNote);
  const [over, setOver] = useState(false);

  return (
    <li
      draggable
      onDragStart={() => {
        draggedNoteId = note.id;
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (draggedNoteId && draggedNoteId !== note.id) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        if (draggedNoteId && draggedNoteId !== note.id) {
          reorderNote(draggedNoteId, note.id);
        }
        draggedNoteId = null;
      }}
      className={`group flex items-center ${over ? "border-t-2 border-accent" : ""}`}
    >
      <button
        type="button"
        onClick={() => openNoteTab(note.id, note.title)}
        style={{ paddingLeft: depth * 12 + 10 }}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 text-left text-sm text-fg-muted hover:text-fg"
      >
        <FileText size={14} className="shrink-0 text-fg-subtle" />
        <span className="truncate">{note.title || "Untitled"}</span>
      </button>
      <button
        type="button"
        aria-label={t("deleteNote")}
        onClick={() => deleteNote(note.id)}
        className="mr-2 rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-danger"
      >
        <Trash2 size={13} />
      </button>
    </li>
  );
}

export function NotesSidebar() {
  const { t } = useTranslation("notes");
  const folders = useNotesStore((s) => s.folders);
  const notes = useNotesStore((s) => s.notes);
  const createNote = useNotesStore((s) => s.createNote);
  const createFolder = useNotesStore((s) => s.createFolder);
  const deleteFolder = useNotesStore((s) => s.deleteFolder);
  const renameFolder = useNotesStore((s) => s.renameFolder);
  const moveNote = useNotesStore((s) => s.moveNote);
  const openNoteTab = useTabsStore((s) => s.openNoteTab);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [overFolder, setOverFolder] = useState<string | null>(null);

  const rootNotes = notes.filter((n) => n.folderId === null);

  function newNote(folderId: string | null) {
    const id = createNote(folderId);
    openNoteTab(id, "Untitled");
  }

  function commitRename() {
    if (editingFolder && draft.trim()) {
      renameFolder(editingFolder, draft.trim());
    }
    setEditingFolder(null);
  }

  return (
    <div className="flex h-full flex-col bg-bg-inset">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          {t("title")}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label={t("newNote")}
            title={t("newNote")}
            onClick={() => newNote(null)}
            className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            <FilePlus size={15} />
          </button>
          <button
            type="button"
            aria-label={t("newFolder")}
            title={t("newFolder")}
            onClick={() => createFolder()}
            className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            <FolderPlus size={15} />
          </button>
        </div>
      </div>

      {/* Root drop zone moves a dragged note out of any folder */}
      <div
        className="min-h-0 flex-1 overflow-y-auto py-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (draggedNoteId) {
            moveNote(draggedNoteId, null);
            draggedNoteId = null;
          }
        }}
      >
        {folders.length === 0 && notes.length === 0 && (
          <p className="px-3 py-2 text-xs text-fg-subtle">{t("empty")}</p>
        )}

        <ul>
          {folders.map((folder) => {
            const folderNotes = notes.filter((n) => n.folderId === folder.id);
            const isCollapsed = collapsed[folder.id];
            return (
              <li key={folder.id}>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggedNoteId) setOverFolder(folder.id);
                  }}
                  onDragLeave={() => setOverFolder(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOverFolder(null);
                    if (draggedNoteId) {
                      moveNote(draggedNoteId, folder.id);
                      draggedNoteId = null;
                    }
                  }}
                  className={`group flex items-center ${
                    overFolder === folder.id ? "bg-accent/15" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [folder.id]: !c[folder.id] }))}
                    className="flex shrink-0 items-center py-1 pl-2 text-fg-muted hover:text-fg"
                  >
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <Folder size={14} className="mr-1.5 shrink-0 text-accent" />
                  {editingFolder === folder.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingFolder(null);
                      }}
                      className="min-w-0 flex-1 rounded border border-accent bg-bg px-1 py-0.5 text-sm text-fg outline-none"
                    />
                  ) : (
                    <span
                      onDoubleClick={() => {
                        setEditingFolder(folder.id);
                        setDraft(folder.name);
                      }}
                      className="min-w-0 flex-1 cursor-text truncate py-1 text-sm text-fg-muted"
                      title={t("renameFolderHint")}
                    >
                      {folder.name}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={t("newNote")}
                    title={t("newNote")}
                    onClick={() => newNote(folder.id)}
                    className="rounded p-0.5 text-fg-subtle hover:text-fg"
                  >
                    <FilePlus size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("deleteFolder")}
                    onClick={() => deleteFolder(folder.id)}
                    className="mr-2 rounded p-0.5 text-fg-subtle hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {!isCollapsed && (
                  <ul>
                    {folderNotes.map((note) => (
                      <NoteRow key={note.id} note={note} depth={1} />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {rootNotes.map((note) => (
            <NoteRow key={note.id} note={note} depth={0} />
          ))}
        </ul>
      </div>
    </div>
  );
}
