import { useTranslation } from "react-i18next";
import { ArrowUpCircle, Circle, Settings } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";

export function StatusBar() {
  const { t } = useTranslation();
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const hasUpdate = useUpdaterStore((s) => s.available !== null);
  const modalOpen = useUpdaterStore((s) => s.modalOpen);
  const openModal = useUpdaterStore((s) => s.openModal);
  const showIndicator = hasUpdate && !modalOpen;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-bg-inset px-2 text-xs text-fg-muted">
      <span className="flex items-center gap-1.5">
        <Circle size={8} className="fill-success text-success" />
        {t("statusBar.ready")}
      </span>
      <span className="ml-3">{t("statusBar.encoding")}</span>

      {showIndicator && (
        <button
          type="button"
          title={t("statusBar.updateAvailable")}
          aria-label={t("statusBar.updateAvailable")}
          onClick={openModal}
          className="ml-auto flex h-5 items-center gap-1 rounded px-1.5 text-accent transition-colors hover:bg-bg-elevated"
        >
          <ArrowUpCircle size={13} strokeWidth={2} />
        </button>
      )}

      <button
        type="button"
        title={t("nav.settings")}
        aria-label={t("nav.settings")}
        onClick={() => setSettingsOpen(true)}
        className={`${showIndicator ? "" : "ml-auto"} flex h-5 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg`}
      >
        <Settings size={14} strokeWidth={1.75} />
      </button>
    </footer>
  );
}
