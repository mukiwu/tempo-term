import { useTranslation } from "react-i18next";
import { useNotesStore } from "@/stores/notesStore";
import { useTabsStore } from "@/stores/tabsStore";
import { NoteEditor } from "./NoteEditor";

export function NoteTabContent({ noteId, tabId }: { noteId: string; tabId: string }) {
  const { t } = useTranslation("notes");
  const note = useNotesStore((s) => s.notes.find((n) => n.id === noteId));
  const updateNote = useNotesStore((s) => s.updateNote);
  const setTabTitle = useTabsStore((s) => s.setTabTitle);

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-subtle">
        {t("notFound")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="shrink-0 border-b border-border px-6 pt-5 pb-2">
        <input
          value={note.title}
          placeholder={t("titlePlaceholder")}
          aria-label={t("titlePlaceholder")}
          onChange={(e) => {
            updateNote(noteId, { title: e.target.value });
            setTabTitle(tabId, e.target.value || "Untitled");
          }}
          className="w-full bg-transparent text-2xl font-bold text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <NoteEditor
          key={noteId}
          content={note.content}
          onChange={(markdown) => updateNote(noteId, { content: markdown })}
        />
      </div>
    </div>
  );
}
