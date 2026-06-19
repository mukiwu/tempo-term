import { useEffect, useState } from "react";
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
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabsStore } from "@/stores/tabsStore";
import type { FolderNode, NoteNode, NotesNode } from "@/modules/notes/lib/notesTree";
import { NotesEmptyState } from "./NotesEmptyState";
import { beginNoteDrag, consumeNoteDragClick, useNoteDragStore } from "./lib/noteDrag";

function NoteRow({ note, depth }: { note: NoteNode; depth: number }) {
  const { t } = useTranslation("notes");
  const openNoteTab = useTabsStore((s) => s.openNoteTab);
  const deleteNote = useNotesStore((s) => s.deleteNote);

  return (
    <li
      data-note-path={note.path}
      onPointerDown={(e) => beginNoteDrag(note.path, note.title || "Untitled", e)}
      className="group flex items-center"
    >
      <button
        type="button"
        onClick={() => {
          // Swallow the click that trails a completed drag so it doesn't open.
          if (consumeNoteDragClick()) {
            return;
          }
          openNoteTab(note.path, note.title || "Untitled");
        }}
        style={{ paddingLeft: depth * 12 + 10 }}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 text-left text-sm text-fg-muted hover:text-fg"
      >
        <FileText size={14} className="shrink-0 text-fg-subtle" />
        <span className="truncate">{note.title || "Untitled"}</span>
        {note.isConflict && (
          <span
            title={t("conflictHint")}
            className="shrink-0 rounded bg-warning/15 px-1 py-0.5 text-[10px] font-medium uppercase text-warning"
          >
            {t("conflictBadge")}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={t("deleteNote")}
        onClick={() => void deleteNote(note.path)}
        className="mr-2 rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-danger"
      >
        <Trash2 size={13} />
      </button>
    </li>
  );
}

function FolderRow({ folder, depth }: { folder: FolderNode; depth: number }) {
  const { t } = useTranslation("notes");
  const createNote = useNotesStore((s) => s.createNote);
  const renameFolder = useNotesStore((s) => s.renameFolder);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const openNoteTab = useTabsStore((s) => s.openNoteTab);
  const isOver = useNoteDragStore(
    (s) => s.hover?.kind === "folder" && s.hover.path === folder.path,
  );

  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function newNoteInFolder() {
    void (async () => {
      const path = await createNote(folder.path);
      openNoteTab(path, "Untitled");
    })();
  }

  function commitRename() {
    const next = draft.trim();
    if (next && next !== folder.name) {
      // Resync from disk if the rename is refused (e.g. a name collision).
      void renameFolder(folder.path, next).catch(() =>
        useNotesStore.getState().refresh(),
      );
    }
    setEditing(false);
  }

  return (
    <li>
      <div
        data-folder-path={folder.path}
        className={`group flex items-center ${isOver ? "bg-accent/15" : ""}`}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{ paddingLeft: depth * 12 + 8 }}
          className="flex shrink-0 items-center py-1 text-fg-muted hover:text-fg"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <Folder size={14} className="mr-1.5 shrink-0 text-accent" />
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            className="min-w-0 flex-1 rounded border border-accent bg-bg px-1 py-0.5 text-sm text-fg outline-none"
          />
        ) : (
          <span
            onDoubleClick={() => {
              setEditing(true);
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
          onClick={newNoteInFolder}
          className="rounded p-0.5 text-fg-subtle hover:text-fg"
        >
          <FilePlus size={13} />
        </button>
        <button
          type="button"
          aria-label={t("deleteFolder")}
          onClick={() => void deleteNote(folder.path)}
          className="mr-2 rounded p-0.5 text-fg-subtle hover:text-danger"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {!collapsed && (
        <ul>
          {folder.children.map((child) => (
            <NodeRow key={child.path} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NodeRow({ node, depth }: { node: NotesNode; depth: number }) {
  if (node.kind === "folder") {
    return <FolderRow folder={node} depth={depth} />;
  }
  return <NoteRow note={node} depth={depth} />;
}

export function NotesSidebar() {
  const { t } = useTranslation("notes");
  const rootPath = useSettingsStore((s) => s.notesFolderPath);
  const tree = useNotesStore((s) => s.tree);
  const createNote = useNotesStore((s) => s.createNote);
  const createFolder = useNotesStore((s) => s.createFolder);
  const openNoteTab = useTabsStore((s) => s.openNoteTab);
  const isOverRoot = useNoteDragStore((s) => s.hover?.kind === "root");

  useEffect(() => {
    if (rootPath) {
      void useNotesStore.getState().setRoot(rootPath);
    }
  }, [rootPath]);

  if (!rootPath) {
    return <NotesEmptyState />;
  }

  function newNote() {
    if (!rootPath) {
      return;
    }
    void (async () => {
      const path = await createNote(rootPath);
      openNoteTab(path, "Untitled");
    })();
  }

  function newFolder() {
    if (!rootPath) {
      return;
    }
    // createFolder deduplicates the name, so this never collides.
    void createFolder(rootPath, "New Folder");
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
            onClick={newNote}
            className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            <FilePlus size={15} />
          </button>
          <button
            type="button"
            aria-label={t("newFolder")}
            title={t("newFolder")}
            onClick={newFolder}
            className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            <FolderPlus size={15} />
          </button>
        </div>
      </div>

      {/* Dropping on empty space here moves a dragged note out to the root. */}
      <div
        data-notes-root={rootPath}
        className={`min-h-0 flex-1 overflow-y-auto py-1 ${isOverRoot ? "bg-accent/10" : ""}`}
      >
        {tree.length === 0 && (
          <p className="px-3 py-2 text-xs text-fg-subtle">{t("empty")}</p>
        )}
        <ul>
          {tree.map((node) => (
            <NodeRow key={node.path} node={node} depth={0} />
          ))}
        </ul>
      </div>
    </div>
  );
}
