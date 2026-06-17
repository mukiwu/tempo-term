import { useTranslation } from "react-i18next";
import { FilePlus, FolderOpen, SquareTerminal } from "lucide-react";
import { TerminalTabContent } from "@/modules/terminal/TerminalTabContent";
import { EditorTabContent } from "@/modules/editor/EditorTabContent";
import { NoteTabContent } from "@/modules/notes/NoteTabContent";
import { PreviewTabContent } from "@/modules/preview/PreviewTabContent";
import { GitGraphTabContent } from "@/modules/git-graph/GitGraphTabContent";
import { EntryDropOverlay, useEntryDragging } from "@/components/EntryDropOverlay";
import { fileUrl, type DraggedEntry } from "@/modules/explorer/lib/dragEntry";
import { insertLinkIntoNote } from "@/modules/notes/lib/noteBus";
import { useTabsStore, type Tab } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUiStore } from "@/stores/uiStore";
import { pickFile, pickFolder } from "@/lib/dialog";

/**
 * The drop behaviour for a standalone (non-split) tab. Returns null for tabs
 * that handle their own drops (terminal) or don't take entries (git-graph).
 */
function tabDropHandlers(
  tab: Tab,
  actions: {
    setEditorTabPath: (tabId: string, path: string) => void;
    setPreviewTabUrl: (tabId: string, url: string) => void;
  },
): { accept: (e: DraggedEntry) => boolean; onDropEntry: (e: DraggedEntry) => void } | null {
  switch (tab.kind) {
    case "editor":
      return {
        accept: (e) => !e.isDir,
        onDropEntry: (e) => actions.setEditorTabPath(tab.id, e.path),
      };
    case "note":
      return {
        accept: () => true,
        onDropEntry: (e) => insertLinkIntoNote(tab.noteId, e.name, e.path),
      };
    case "preview":
      return {
        accept: (e) => !e.isDir,
        onDropEntry: (e) => actions.setPreviewTabUrl(tab.id, fileUrl(e.path)),
      };
    default:
      return null;
  }
}

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
  const setEditorTabPath = useTabsStore((s) => s.setEditorTabPath);
  const setPreviewTabUrl = useTabsStore((s) => s.setPreviewTabUrl);
  const dragging = useEntryDragging();

  if (!activeId) {
    return <EmptyState />;
  }

  return (
    <div className="relative h-full w-full bg-bg">
      {tabs.map((tab) => {
        const drop = tabDropHandlers(tab, { setEditorTabPath, setPreviewTabUrl });
        return (
          <div
            key={tab.id}
            className={`absolute inset-0 ${tab.id === activeId ? "" : "hidden"}`}
          >
            {tab.kind === "terminal" && <TerminalTabContent tab={tab} />}
            {tab.kind === "editor" && <EditorTabContent path={tab.path} />}
            {tab.kind === "note" && <NoteTabContent noteId={tab.noteId} tabId={tab.id} />}
            {tab.kind === "preview" && <PreviewTabContent url={tab.url} />}
            {tab.kind === "git-graph" && <GitGraphTabContent />}

            {/* Terminal tabs handle drops per-pane; other tabs drop here. */}
            {dragging && tab.id === activeId && drop && (
              <EntryDropOverlay accept={drop.accept} onDropEntry={drop.onDropEntry} />
            )}
          </div>
        );
      })}
    </div>
  );
}
