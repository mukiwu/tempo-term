import { useTranslation } from "react-i18next";
import { FolderPlus, X } from "lucide-react";
import { useWorkspaceTabsStore } from "@/stores/workspaceTabsStore";
import { pickFolder } from "@/lib/dialog";

export function WorkspaceTabBar() {
  const { t } = useTranslation();
  const tabs = useWorkspaceTabsStore((s) => s.tabs);
  const activeTabId = useWorkspaceTabsStore((s) => s.activeTabId);
  const openWorkspace = useWorkspaceTabsStore((s) => s.openWorkspace);
  const closeTab = useWorkspaceTabsStore((s) => s.closeTab);
  const setActive = useWorkspaceTabsStore((s) => s.setActive);

  async function openFolder() {
    const folder = await pickFolder();
    if (folder) {
      openWorkspace(folder);
    }
  }

  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-bg-inset pl-20 pr-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => setActive(tab.id)}
              title={tab.rootPath}
              className={`group flex h-7 cursor-pointer items-center gap-2 rounded-md px-3 text-xs transition-colors ${
                active
                  ? "bg-bg-elevated text-fg"
                  : "text-fg-muted hover:bg-bg-elevated/60"
              }`}
            >
              <span className="max-w-[160px] truncate">{tab.name}</span>
              <button
                type="button"
                aria-label={t("workspace.closeWorkspace")}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="rounded p-0.5 text-fg-subtle opacity-0 hover:bg-border-strong hover:text-fg group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label={t("workspace.openFolder")}
        title={t("workspace.openFolder")}
        onClick={openFolder}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg"
      >
        <FolderPlus size={16} />
      </button>
    </header>
  );
}
