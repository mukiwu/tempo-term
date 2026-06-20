import { useTranslation } from "react-i18next";
import { Circle, Settings } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";

export function StatusBar() {
  const { t } = useTranslation();
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-bg-inset px-2 text-xs text-fg-muted">
      <span className="flex items-center gap-1.5">
        <Circle size={8} className="fill-success text-success" />
        {t("statusBar.ready")}
      </span>
      <span className="ml-3">{t("statusBar.encoding")}</span>

      <button
        type="button"
        title={t("nav.settings")}
        aria-label={t("nav.settings")}
        onClick={() => setSettingsOpen(true)}
        className="ml-auto flex h-5 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg"
      >
        <Settings size={14} strokeWidth={1.75} />
      </button>
    </footer>
  );
}
