import { Sparkles, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUpdaterStore } from "@/stores/updaterStore";
import { MarkdownView } from "./MarkdownView";
import { separateLanguageSections } from "./releaseNotes";

const NOTES_PREVIEW_CHARS = 600;

/**
 * Prompt shown when the updater finds a newer build. It reads everything from
 * the updater store, so both the silent launch check and the manual "check for
 * updates" button surface the same dialog.
 */
export function UpdateModal() {
  const { t } = useTranslation("settings");
  const available = useUpdaterStore((s) => s.available);
  const modalOpen = useUpdaterStore((s) => s.modalOpen);
  const installing = useUpdaterStore((s) => s.installing);
  const errorMessage = useUpdaterStore((s) => s.errorMessage);
  const installUpdate = useUpdaterStore((s) => s.installUpdate);
  const dismiss = useUpdaterStore((s) => s.dismissModal);

  if (!modalOpen || !available) {
    return null;
  }

  const version = available.version;
  const notes = available.notes;

  const divided = separateLanguageSections(notes);
  const truncated = divided.length > NOTES_PREVIEW_CHARS;
  const preview = truncated ? `${divided.slice(0, NOTES_PREVIEW_CHARS).trimEnd()}…` : divided;

  return (
    <>
      <div
        className="fixed inset-0 z-[95] bg-black/60"
        onClick={installing ? undefined : dismiss}
      />
      <div className="fixed left-1/2 top-1/2 z-[100] w-[480px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-elevated shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Sparkles size={16} className="text-accent" />
            {t("update.available", { version })}
          </span>
          {!installing && (
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("update.later")}
              className="text-fg-muted hover:text-fg"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="px-4 py-4">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            {t("update.notes")}
          </div>
          <div className="max-h-[260px] overflow-auto rounded border border-border bg-bg-inset p-3">
            <MarkdownView content={preview || "—"} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          {errorMessage && (
            <span className="mr-auto text-xs text-danger">{errorMessage}</span>
          )}
          <button
            type="button"
            onClick={dismiss}
            disabled={installing}
            className="rounded-md px-3 py-1.5 text-xs text-fg-muted hover:text-fg disabled:opacity-50"
          >
            {t("update.later")}
          </button>
          <button
            type="button"
            onClick={() => void installUpdate()}
            disabled={installing}
            className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {installing && <Loader2 size={14} className="animate-spin" />}
            {installing ? t("update.installing") : t("update.install")}
          </button>
        </div>
      </div>
    </>
  );
}
