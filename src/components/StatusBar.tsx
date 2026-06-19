import { useTranslation } from "react-i18next";
import { Activity, Circle, Settings } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { totalActiveCount, useProgressStore } from "@/modules/claude-progress/lib/progressStore";

export function StatusBar() {
  const { t } = useTranslation();
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const sessions = useProgressStore((s) => s.sessions);
  const togglePanel = useProgressStore((s) => s.togglePanel);
  const count = totalActiveCount(sessions);
  const active = count > 0;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-bg-inset px-2 text-xs text-fg-muted">
      <span className="flex items-center gap-1.5">
        <Circle size={8} className="fill-success text-success" />
        {t("statusBar.ready")}
      </span>
      <span className="ml-3">{t("statusBar.encoding")}</span>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          title="Claude 進度"
          aria-label="Claude 進度"
          onClick={togglePanel}
          className={`relative flex h-5 w-6 items-center justify-center rounded transition-colors ${
            active ? "text-accent" : "text-fg-subtle hover:text-fg"
          }`}
        >
          <Activity size={14} strokeWidth={1.75} />
          {active && (
            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold leading-none text-bg">
              {count}
            </span>
          )}
        </button>

        <button
          type="button"
          title={t("nav.settings")}
          aria-label={t("nav.settings")}
          onClick={() => setSettingsOpen(true)}
          className="flex h-5 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg"
        >
          <Settings size={14} strokeWidth={1.75} />
        </button>
      </div>
    </footer>
  );
}
