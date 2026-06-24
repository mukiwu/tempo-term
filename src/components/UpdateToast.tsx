import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { useUpdaterStore } from "@/stores/updaterStore";

const FADE_MS = 6000;

/**
 * Transient bottom-right notice shown when a periodic check finds a newer build.
 * Auto-fades after a few seconds; clicking opens the full UpdateModal. Never
 * blocks input, so it doesn't interrupt work in the terminal.
 */
export function UpdateToast() {
  const { t } = useTranslation("settings");
  const toast = useUpdaterStore((s) => s.toast);
  const clearToast = useUpdaterStore((s) => s.clearToast);
  const openModal = useUpdaterStore((s) => s.openModal);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(clearToast, FADE_MS);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);

  if (!toast) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={openModal}
      className="fixed bottom-10 right-4 z-[90] flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3.5 py-2.5 text-xs text-fg shadow-2xl transition-colors hover:border-accent"
    >
      <Sparkles size={14} className="shrink-0 text-accent" />
      <span>{t("update.toast", { version: toast.version })}</span>
    </button>
  );
}
