import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useNotesStore } from "@/stores/notesStore";
import { pickNotesFolder } from "./lib/pickNotesFolder";

/**
 * First-run screen for the notes sidebar, shown before the user has chosen a
 * folder to back their notes. Picking a folder records it in settings and
 * points the notes store at it.
 */
export function NotesEmptyState() {
  const { t } = useTranslation("notes");

  function chooseFolder() {
    void (async () => {
      const path = await pickNotesFolder();
      if (!path) {
        return;
      }
      useSettingsStore.getState().setNotesFolderPath(path);
      await useNotesStore.getState().setRoot(path);
    })();
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg-inset px-6 text-center">
      <button
        type="button"
        onClick={chooseFolder}
        className="flex items-center gap-2 rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-fg hover:bg-border-strong"
      >
        <FolderOpen size={15} className="shrink-0 text-accent" />
        {t("pickFolderCta")}
      </button>
      <div className="space-y-1.5 text-xs text-fg-subtle">
        <p className="text-fg-muted">{t("syncHintCloud")}</p>
        <p>{t("syncHintGit")}</p>
      </div>
    </div>
  );
}
