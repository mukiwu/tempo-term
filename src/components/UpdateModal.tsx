import { Sparkles, Loader2, ExternalLink, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUpdaterStore } from "@/stores/updaterStore";

const NOTES_PREVIEW_CHARS = 600;

/**
 * Prompt shown when the updater finds a newer build. It reads everything from
 * the updater store, so both the silent launch check and the manual "check for
 * updates" button surface the same dialog.
 */
export function UpdateModal() {
  const { t } = useTranslation("settings");
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const notes = useUpdaterStore((s) => s.notes);
  const releaseUrl = useUpdaterStore((s) => s.releaseUrl);
  const installing = useUpdaterStore((s) => s.installing);
  const installUpdate = useUpdaterStore((s) => s.installUpdate);
  const dismiss = useUpdaterStore((s) => s.dismiss);

  if (status !== "available") {
    return null;
  }

  const truncated = notes.length > NOTES_PREVIEW_CHARS;
  const preview = truncated ? `${notes.slice(0, NOTES_PREVIEW_CHARS).trimEnd()}…` : notes;

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
          <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-inset p-3 font-sans text-xs leading-relaxed text-fg-muted">
            {preview || "—"}
          </pre>
          {releaseUrl && (
            <a
              href={releaseUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <ExternalLink size={12} />
              {t("update.viewFullNotes")}
            </a>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
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
