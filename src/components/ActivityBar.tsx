import { useTranslation } from "react-i18next";
import {
  Bot,
  FolderTree,
  GitBranch,
  Settings,
  SquareTerminal,
  FileCode,
  type LucideIcon,
} from "lucide-react";
import { useUiStore, type ViewId } from "@/stores/uiStore";

interface ActivityItem {
  id: ViewId;
  icon: LucideIcon;
  labelKey: string;
}

const PRIMARY_ITEMS: ActivityItem[] = [
  { id: "terminal", icon: SquareTerminal, labelKey: "nav.terminal" },
  { id: "explorer", icon: FolderTree, labelKey: "nav.explorer" },
  { id: "editor", icon: FileCode, labelKey: "nav.editor" },
  { id: "sourceControl", icon: GitBranch, labelKey: "nav.sourceControl" },
  { id: "ai", icon: Bot, labelKey: "nav.ai" },
];

export function ActivityBar() {
  const { t } = useTranslation();
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);

  function renderButton({ id, icon: Icon, labelKey }: ActivityItem) {
    const active = activeView === id;
    const label = t(labelKey);
    return (
      <button
        key={id}
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={active}
        onClick={() => setActiveView(id)}
        className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
          active
            ? "bg-[--color-bg-elevated] text-[--color-accent]"
            : "text-[--color-fg-subtle] hover:text-[--color-fg] hover:bg-[--color-bg-elevated]"
        }`}
      >
        <Icon size={20} strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-[--color-border] bg-[--color-bg-inset] py-2">
      {PRIMARY_ITEMS.map(renderButton)}
      <div className="mt-auto">
        {renderButton({ id: "settings", icon: Settings, labelKey: "nav.settings" })}
      </div>
    </nav>
  );
}
