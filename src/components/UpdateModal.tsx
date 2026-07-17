import { Sparkles, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUpdaterStore } from "@/stores/updaterStore";
import { useOverlayGuard } from "@/lib/overlayGuard";
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
  const progress = useUpdaterStore((s) => s.progress);
  const installPhase = useUpdaterStore((s) => s.installPhase);
  const errorMessage = useUpdaterStore((s) => s.errorMessage);
  const installUpdate = useUpdaterStore((s) => s.installUpdate);
  const dismiss = useUpdaterStore((s) => s.dismissModal);

  // Hide the native preview webview while this modal is on screen.
  useOverlayGuard(modalOpen && available !== null);

  if (!modalOpen || !available) {
    return null;
  }

  const version = available.version;
  const notes = available.notes;

  const divided = separateLanguageSections(notes);
  const truncated = divided.length > NOTES_PREVIEW_CHARS;
  const preview = truncated ? `${divided.slice(0, NOTES_PREVIEW_CHARS).trimEnd()}…` : divided;

  const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
  const percent =
    progress && progress.total !== null
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;
  // The bar fills from download percent, then pins at 100% while extracting.
  const barValue = installPhase === "installing" ? 100 : percent;

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

        {installing && (
          <div className="px-4 pb-4">
            <div className="mb-1.5 flex items-center justify-between text-xs text-fg-muted">
              <span>
                {installPhase === "installing"
                  ? t("update.finalizing")
                  : t("update.downloading")}
              </span>
              {installPhase === "downloading" && progress && (
                <span>
                  {progress.total !== null
                    ? t("update.progressOfTotal", {
                        done: mb(progress.downloaded),
                        total: mb(progress.total),
                        percent,
                      })
                    : t("update.progressNoTotal", { done: mb(progress.downloaded) })}
                </span>
              )}
            </div>
            {barValue !== null && (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={barValue}
                className="h-1.5 overflow-hidden rounded-full bg-bg-inset"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${barValue}%` }}
                />
              </div>
            )}
          </div>
        )}

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
