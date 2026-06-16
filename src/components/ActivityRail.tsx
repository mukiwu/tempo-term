import { useTranslation } from "react-i18next";
import { Bot, FolderTree, GitBranch, Settings, type LucideIcon } from "lucide-react";
import { useUiStore, type SidebarView } from "@/stores/uiStore";

interface RailItem {
  id: SidebarView;
  icon: LucideIcon;
  labelKey: string;
}

const ITEMS: RailItem[] = [
  { id: "explorer", icon: FolderTree, labelKey: "nav.explorer" },
  { id: "sourceControl", icon: GitBranch, labelKey: "nav.sourceControl" },
  { id: "ai", icon: Bot, labelKey: "nav.ai" },
];

export function ActivityRail() {
  const { t } = useTranslation();
  const sidebarView = useUiStore((s) => s.sidebarView);
  const sidebarVisible = useUiStore((s) => s.sidebarVisible);
  const selectSidebar = useUiStore((s) => s.selectSidebar);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  function railButton({ id, icon: Icon, labelKey }: RailItem) {
    const active = sidebarView === id && sidebarVisible;
    const label = t(labelKey);
    return (
      <button
        key={id}
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={active}
        onClick={() => selectSidebar(id)}
        className={`relative flex h-11 w-11 items-center justify-center transition-colors ${
          active ? "text-fg" : "text-fg-subtle hover:text-fg"
        }`}
      >
        {active && (
          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
        )}
        <Icon size={20} strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center border-r border-border bg-bg-inset py-1">
      {ITEMS.map(railButton)}
      <button
        type="button"
        title={t("nav.settings")}
        aria-label={t("nav.settings")}
        onClick={() => setSettingsOpen(true)}
        className="mt-auto flex h-11 w-11 items-center justify-center text-fg-subtle transition-colors hover:text-fg"
      >
        <Settings size={20} strokeWidth={1.75} />
      </button>
    </nav>
  );
}
