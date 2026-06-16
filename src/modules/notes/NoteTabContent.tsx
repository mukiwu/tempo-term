import { useTranslation } from "react-i18next";
import { useNotesStore } from "@/stores/notesStore";
import { useTabsStore } from "@/stores/tabsStore";

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
      <input
        value={note.title}
        placeholder={t("titlePlaceholder")}
        aria-label={t("titlePlaceholder")}
        onChange={(e) => {
          updateNote(noteId, { title: e.target.value });
          setTabTitle(tabId, e.target.value || "Untitled");
        }}
        className="shrink-0 border-b border-border bg-transparent px-5 py-3 text-lg font-semibold text-fg outline-none placeholder:text-fg-subtle"
      />
      <textarea
        value={note.content}
        placeholder={t("contentPlaceholder")}
        onChange={(e) => updateNote(noteId, { content: e.target.value })}
        className="min-h-0 flex-1 resize-none bg-transparent px-5 py-4 font-mono text-sm leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
      />
    </div>
  );
}
