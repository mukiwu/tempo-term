import { useTranslation } from "react-i18next";
import { Bot, Circle, Settings, type LucideIcon } from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useUiStore, type SidebarView } from "@/stores/uiStore";

interface RailItem {
  id: SidebarView;
  icon: LucideIcon;
  labelKey: string;
}

// Explorer / Git / Notes live as tabs inside the sidebar now; the footer keeps
// the AI panel toggle and settings.
const SIDEBAR_ITEMS: RailItem[] = [{ id: "ai", icon: Bot, labelKey: "nav.ai" }];

export function StatusBar() {
  const { t } = useTranslation();
  const sidebarView = useUiStore((s) => s.sidebarView);
  const sidebarVisible = useUiStore((s) => s.sidebarVisible);
  const selectSidebar = useUiStore((s) => s.selectSidebar);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-bg-inset px-2 text-xs text-fg-muted">
      {/* Sidebar view switchers (moved here from a left rail to save width) */}
      {SIDEBAR_ITEMS.map(({ id, icon: Icon, labelKey }) => {
        const active = sidebarView === id && sidebarVisible;
        return (
          <button
            key={id}
            type="button"
            title={t(labelKey)}
            aria-label={t(labelKey)}
            aria-pressed={active}
            onClick={() => selectSidebar(id)}
            className={`flex h-5 w-6 items-center justify-center rounded transition-colors ${
              active ? "text-accent" : "text-fg-subtle hover:text-fg"
            }`}
          >
            <Icon size={14} strokeWidth={1.75} />
          </button>
        );
      })}
      <button
        type="button"
        title={t("nav.settings")}
        aria-label={t("nav.settings")}
        onClick={() => setSettingsOpen(true)}
        className="flex h-5 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg"
      >
        <Settings size={14} strokeWidth={1.75} />
      </button>

      <span className="ml-3 flex items-center gap-1.5">
        <Circle size={8} className="fill-success text-success" />
        {t("statusBar.ready")}
      </span>
      <span className="ml-3">{t("statusBar.encoding")}</span>

      <div className="ml-auto">
        <LanguageSwitcher />
      </div>
    </footer>
  );
}
