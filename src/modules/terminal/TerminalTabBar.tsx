import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { useTerminalTabsStore } from "./store/terminalTabsStore";

export function TerminalTabBar() {
  const { t } = useTranslation();
  const tabs = useTerminalTabsStore((s) => s.tabs);
  const activeTabId = useTerminalTabsStore((s) => s.activeTabId);
  const addTab = useTerminalTabsStore((s) => s.addTab);
  const closeTab = useTerminalTabsStore((s) => s.closeTab);
  const setActive = useTerminalTabsStore((s) => s.setActive);

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[--color-border] bg-[--color-bg-inset] px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => setActive(tab.id)}
              className={`group flex h-7 cursor-pointer items-center gap-2 rounded-md px-3 text-xs transition-colors ${
                active
                  ? "bg-[--color-bg-elevated] text-[--color-fg]"
                  : "text-[--color-fg-muted] hover:bg-[--color-bg-elevated]/60"
              }`}
            >
              <span className="whitespace-nowrap">{tab.title}</span>
              <button
                type="button"
                aria-label={t("actions.closeTab")}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="rounded p-0.5 text-[--color-fg-subtle] opacity-0 hover:bg-[--color-border-strong] hover:text-[--color-fg] group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label={t("actions.newTab")}
        title={t("actions.newTab")}
        onClick={() => addTab()}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[--color-fg-muted] hover:bg-[--color-bg-elevated] hover:text-[--color-fg]"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
