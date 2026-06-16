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

function NoteRow({ note, depth }: { note: Note; depth: number }) {
  const { t } = useTranslation("notes");
  const openNoteTab = useTabsStore((s) => s.openNoteTab);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  return (
    <li className="group flex items-center">
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
        className="mr-2 rounded p-0.5 text-fg-subtle opacity-0 hover:bg-border-strong hover:text-danger group-hover:opacity-100"
      >
        <Trash2 size={12} />
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
  const openNoteTab = useTabsStore((s) => s.openNoteTab);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const rootNotes = notes.filter((n) => n.folderId === null);

  function newNote(folderId: string | null) {
    const id = createNote(folderId);
    openNoteTab(id, "Untitled");
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

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {folders.length === 0 && notes.length === 0 && (
          <p className="px-3 py-2 text-xs text-fg-subtle">{t("empty")}</p>
        )}

        <ul>
          {folders.map((folder) => {
            const folderNotes = notes.filter((n) => n.folderId === folder.id);
            const isCollapsed = collapsed[folder.id];
            return (
              <li key={folder.id}>
                <div className="group flex items-center">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [folder.id]: !c[folder.id] }))
                    }
                    className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2 pr-2 text-left text-sm text-fg-muted hover:text-fg"
                  >
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <Folder size={14} className="shrink-0 text-accent" />
                    <span className="truncate">{folder.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={t("newNote")}
                    title={t("newNote")}
                    onClick={() => newNote(folder.id)}
                    className="rounded p-0.5 text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100"
                  >
                    <FilePlus size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("deleteFolder")}
                    onClick={() => deleteFolder(folder.id)}
                    className="mr-2 rounded p-0.5 text-fg-subtle opacity-0 hover:text-danger group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
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
