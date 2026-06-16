import { useTranslation } from "react-i18next";
import { FilePlus, FolderOpen, SquareTerminal } from "lucide-react";
import { TerminalTabContent } from "@/modules/terminal/TerminalTabContent";
import { EditorTabContent } from "@/modules/editor/EditorTabContent";
import { NoteTabContent } from "@/modules/notes/NoteTabContent";
import { PreviewTabContent } from "@/modules/preview/PreviewTabContent";
import { GitGraphTabContent } from "@/modules/git-graph/GitGraphTabContent";
import { useTabsStore } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUiStore } from "@/stores/uiStore";
import { pickFile, pickFolder } from "@/lib/dialog";

function EmptyState() {
  const { t } = useTranslation();
  const newTerminalTab = useTabsStore((s) => s.newTerminalTab);
  const openEditorTab = useTabsStore((s) => s.openEditorTab);
  const setRoot = useWorkspaceStore((s) => s.setRoot);
  const selectSidebar = useUiStore((s) => s.selectSidebar);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-fg-subtle">
      <p className="text-sm">{t("workspace.noWorkspaceHint")}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() =>
            newTerminalTab(useWorkspaceStore.getState().rootPath ?? undefined)
          }
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg"
        >
          <SquareTerminal size={16} />
          {t("workspace.newTerminal")}
        </button>
        <button
          type="button"
          onClick={async () => {
            const folder = await pickFolder();
            if (folder) {
              setRoot(folder);
              selectSidebar("explorer");
            }
          }}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg"
        >
          <FolderOpen size={16} />
          {t("workspace.openFolder")}
        </button>
        <button
          type="button"
          onClick={async () => {
            const file = await pickFile();
            if (file) {
              openEditorTab(file);
            }
          }}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg"
        >
          <FilePlus size={16} />
          {t("workspace.openFile")}
        </button>
      </div>
    </div>
  );
}

export function TabsArea() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);

  if (!activeId) {
    return <EmptyState />;
  }

  return (
    <div className="relative h-full w-full bg-bg">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`absolute inset-0 ${tab.id === activeId ? "" : "hidden"}`}
        >
          {tab.kind === "terminal" && <TerminalTabContent tab={tab} />}
          {tab.kind === "editor" && <EditorTabContent path={tab.path} />}
          {tab.kind === "note" && <NoteTabContent noteId={tab.noteId} tabId={tab.id} />}
          {tab.kind === "preview" && <PreviewTabContent url={tab.url} />}
          {tab.kind === "git-graph" && <GitGraphTabContent />}
        </div>
      ))}
    </div>
  );
}
