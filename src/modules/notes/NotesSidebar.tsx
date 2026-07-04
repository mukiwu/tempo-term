import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  FilePlus,
  FolderCog,
  FolderPlus,
  FileText,
  Folder,
  Trash2,
  SquarePlus,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { InfoDialog } from "@/components/InfoDialog";
import { Tooltip } from "@/components/Tooltip";
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabsStore } from "@/stores/tabsStore";
import type { FolderNode, NoteNode, NotesNode } from "@/modules/notes/lib/notesTree";
import { NotesEmptyState } from "./NotesEmptyState";
import { beginNoteDrag, consumeNoteDragClick, useNoteDragStore } from "./lib/noteDrag";
import { pickNotesFolder } from "./lib/pickNotesFolder";

function NoteRow({ note, depth }: { note: NoteNode; depth: number }) {
  const { t } = useTranslation("notes");
  const { t: tCommon } = useTranslation("common");
  const openFromSidebar = useTabsStore((s) => s.openFromSidebar);
  const openInNewTab = useTabsStore((s) => s.openInNewTab);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const [atCapacity, setAtCapacity] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <li
      data-note-path={note.path}
      onPointerDown={(e) => beginNoteDrag(note.path, note.title || "Untitled", e)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      className="group flex items-center"
    >
      <button
        type="button"
        onClick={() => {
          // Swallow the click that trails a completed drag so it doesn't open.
          if (consumeNoteDragClick()) {
            return;
          }
          const result = openFromSidebar({ kind: "note", noteId: note.path }, note.title || "Untitled");
          if (result.status === "at-capacity") {
            setAtCapacity(true);
          }
        }}
        style={{ paddingLeft: depth * 12 + 10 }}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 text-left text-sm text-fg-muted hover:text-fg"
      >
        <FileText size={14} className="shrink-0 text-fg-subtle" />
        <span className="truncate">{note.title || "Untitled"}</span>
        {note.isConflict && (
          <Tooltip label={t("conflictHint")} className="shrink-0">
            <span className="rounded bg-warning/15 px-1 py-0.5 text-[10px] font-medium uppercase text-warning">
              {t("conflictBadge")}
            </span>
          </Tooltip>
        )}
      </button>
      <Tooltip label={t("deleteNote")} className="mr-2">
        <button
          type="button"
          aria-label={t("deleteNote")}
          onClick={() => void deleteNote(note.path)}
          className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-danger"
        >
          <Trash2 size={13} />
        </button>
      </Tooltip>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              id: "open",
              label: t("open"),
              icon: Columns2,
              group: 0,
              onSelect: () => {
                const result = openFromSidebar({ kind: "note", noteId: note.path }, note.title || "Untitled");
                if (result.status === "at-capacity") {
                  setAtCapacity(true);
                }
              },
            } satisfies ContextMenuItem,
            {
              id: "openInNewTab",
              label: t("openInNewTab"),
              icon: SquarePlus,
              group: 0,
              onSelect: () => openInNewTab({ kind: "note", noteId: note.path }, note.title || "Untitled"),
            } satisfies ContextMenuItem,
          ]}
        />
      )}
      {atCapacity && (
        <InfoDialog
          title={t("open")}
          message={tCommon("paneCapacityAlert")}
          confirmLabel={tCommon("actions.confirm")}
          onConfirm={() => setAtCapacity(false)}
        />
      )}
    </li>
  );
}

function FolderRow({ folder, depth }: { folder: FolderNode; depth: number }) {
  const { t } = useTranslation("notes");
  const { t: tCommon } = useTranslation("common");
  const createNote = useNotesStore((s) => s.createNote);
  const renameFolder = useNotesStore((s) => s.renameFolder);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const openFromSidebar = useTabsStore((s) => s.openFromSidebar);
  const isOver = useNoteDragStore(
    (s) => s.hover?.kind === "folder" && s.hover.path === folder.path,
  );

  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [atCapacity, setAtCapacity] = useState(false);

  function newNoteInFolder() {
    void (async () => {
      const path = await createNote(folder.path);
      const result = openFromSidebar({ kind: "note", noteId: path }, "Untitled");
      if (result.status === "at-capacity") {
        setAtCapacity(true);
      }
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
          <Tooltip label={t("renameFolderHint")} className="min-w-0 flex-1">
            <span
              onDoubleClick={() => {
                setEditing(true);
                setDraft(folder.name);
              }}
              className="min-w-0 flex-1 cursor-text truncate py-1 text-sm text-fg-muted"
            >
              {folder.name}
            </span>
          </Tooltip>
        )}
        <Tooltip label={t("newNote")}>
          <button
            type="button"
            aria-label={t("newNote")}
            onClick={newNoteInFolder}
            className="rounded p-0.5 text-fg-subtle hover:text-fg"
          >
            <FilePlus size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t("deleteFolder")} className="mr-2">
          <button
            type="button"
            aria-label={t("deleteFolder")}
            onClick={() => void deleteNote(folder.path)}
            className="rounded p-0.5 text-fg-subtle hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        </Tooltip>
      </div>
      {!collapsed && (
        <ul>
          {folder.children.map((child) => (
            <NodeRow key={child.path} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
      {atCapacity && (
        <InfoDialog
          title={t("newNote")}
          message={tCommon("paneCapacityAlert")}
          confirmLabel={tCommon("actions.confirm")}
          onConfirm={() => setAtCapacity(false)}
        />
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
  const { t: tCommon } = useTranslation("common");
  const rootPath = useSettingsStore((s) => s.notesFolderPath);
  const tree = useNotesStore((s) => s.tree);
  const createNote = useNotesStore((s) => s.createNote);
  const createFolder = useNotesStore((s) => s.createFolder);
  const openFromSidebar = useTabsStore((s) => s.openFromSidebar);
  const isOverRoot = useNoteDragStore((s) => s.hover?.kind === "root");
  const [atCapacity, setAtCapacity] = useState(false);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);

  if (!rootPath) {
    return <NotesEmptyState />;
  }

  function changeFolder() {
    void (async () => {
      try {
        const path = await pickNotesFolder();
        if (!path || path === rootPath) {
          return;
        }
        setPendingFolder(path);
      } catch {
        // Dialog plugin failure; nothing to recover, just don't crash the app.
      }
    })();
  }

  function confirmChangeFolder() {
    if (!pendingFolder) {
      return;
    }
    useSettingsStore.getState().setNotesFolderPath(pendingFolder);
    void useNotesStore.getState().setRoot(pendingFolder);
    setPendingFolder(null);
  }

  function newNote() {
    if (!rootPath) {
      return;
    }
    void (async () => {
      const path = await createNote(rootPath);
      const result = openFromSidebar({ kind: "note", noteId: path }, "Untitled");
      if (result.status === "at-capacity") {
        setAtCapacity(true);
      }
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
          <Tooltip label={t("newNote")}>
            <button
              type="button"
              aria-label={t("newNote")}
              onClick={newNote}
              className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
            >
              <FilePlus size={15} />
            </button>
          </Tooltip>
          <Tooltip label={t("newFolder")}>
            <button
              type="button"
              aria-label={t("newFolder")}
              onClick={newFolder}
              className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
            >
              <FolderPlus size={15} />
            </button>
          </Tooltip>
          <Tooltip label={t("changeFolder")}>
            <button
              type="button"
              aria-label={t("changeFolder")}
              onClick={changeFolder}
              className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
            >
              <FolderCog size={15} />
            </button>
          </Tooltip>
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

      {atCapacity && (
        <InfoDialog
          title={t("newNote")}
          message={tCommon("paneCapacityAlert")}
          confirmLabel={tCommon("actions.confirm")}
          onConfirm={() => setAtCapacity(false)}
        />
      )}
      {pendingFolder && (
        <ConfirmDialog
          title={t("changeFolderConfirmTitle")}
          message={t("changeFolderConfirmMessage", { path: pendingFolder })}
          confirmLabel={tCommon("actions.confirm")}
          cancelLabel={tCommon("actions.cancel")}
          onConfirm={confirmChangeFolder}
          onCancel={() => setPendingFolder(null)}
        />
      )}
    </div>
  );
}
