import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileCode,
  FilePlus,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  Plus,
  SquareTerminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTabsStore, type Tab } from "@/stores/tabsStore";
import { useEditorStore } from "@/modules/editor/store/editorStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUiStore } from "@/stores/uiStore";
import { pickFile, pickFolder } from "@/lib/dialog";
import { SpaceDropdown } from "./SpaceDropdown";

const DEFAULT_PREVIEW_URL = "http://localhost:3000";

function tabIcon(kind: Tab["kind"]): LucideIcon {
  switch (kind) {
    case "terminal":
      return SquareTerminal;
    case "editor":
      return FileCode;
    case "note":
      return FileText;
    case "preview":
      return Globe;
    case "git-graph":
      return GitBranch;
  }
}

function TabItem({ id }: { id: string }) {
  const { t } = useTranslation();
  const tab = useTabsStore((s) => s.tabs.find((x) => x.id === id));
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);
  const dirty = useEditorStore((s) =>
    tab?.kind === "editor"
      ? (s.buffers[tab.path]?.content ?? "") !== (s.buffers[tab.path]?.baseline ?? "")
      : false,
  );
  if (!tab) {
    return null;
  }
  const active = tab.id === activeId;
  const Icon = tabIcon(tab.kind);
  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={() => setActive(tab.id)}
      title={tab.title}
      className={`group flex h-7 cursor-pointer items-center gap-2 rounded-md px-3 text-xs transition-colors ${
        active ? "bg-bg-elevated text-fg" : "text-fg-muted hover:bg-bg-elevated/60"
      }`}
    >
      <Icon size={13} className="shrink-0" />
      <span className="max-w-[160px] truncate">{tab.title}</span>
      {dirty && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
      <button
        type="button"
        aria-label={t("actions.closeTab")}
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
}

export function TabBar() {
  const { t } = useTranslation();
  const tabs = useTabsStore((s) => s.tabs);
  const activeSpaceId = useTabsStore((s) => s.activeSpaceId);
  const visibleTabs = tabs.filter((tab) => tab.spaceId === activeSpaceId);
  const newTerminalTab = useTabsStore((s) => s.newTerminalTab);
  const openEditorTab = useTabsStore((s) => s.openEditorTab);
  const openPreviewTab = useTabsStore((s) => s.openPreviewTab);
  const openGitGraphTab = useTabsStore((s) => s.openGitGraphTab);
  const setRoot = useWorkspaceStore((s) => s.setRoot);
  const selectSidebar = useUiStore((s) => s.selectSidebar);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  function addTerminal() {
    setMenuOpen(false);
    newTerminalTab(useWorkspaceStore.getState().rootPath ?? undefined);
  }

  function addPreview() {
    setMenuOpen(false);
    openPreviewTab(DEFAULT_PREVIEW_URL);
  }

  function addGitGraph() {
    setMenuOpen(false);
    openGitGraphTab();
  }

  async function openFolder() {
    setMenuOpen(false);
    const folder = await pickFolder();
    if (folder) {
      setRoot(folder);
      selectSidebar("explorer");
    }
  }

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  async function openFile() {
    setMenuOpen(false);
    const file = await pickFile();
    if (file) {
      openEditorTab(file);
    }
  }

  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-bg-inset pl-20 pr-2"
    >
      <SpaceDropdown />
      <div className="mx-1 h-4 w-px shrink-0 bg-border" />
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {visibleTabs.map((tab) => (
          <TabItem key={tab.id} id={tab.id} />
        ))}
      </div>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-label={t("workspace.newTerminal")}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <Plus size={16} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-8 z-50 w-48 overflow-hidden rounded-lg border border-border-strong bg-bg-elevated py-1 shadow-xl">
            <button
              type="button"
              onClick={addTerminal}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-muted hover:bg-bg hover:text-fg"
            >
              <SquareTerminal size={15} />
              <span className="flex-1">{t("workspace.terminal")}</span>
              <kbd className="text-[10px] text-fg-subtle">⌘T</kbd>
            </button>
            <button
              type="button"
              onClick={() => void openFolder()}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-muted hover:bg-bg hover:text-fg"
            >
              <FolderOpen size={15} />
              <span className="flex-1">{t("workspace.openFolder")}</span>
            </button>
            <button
              type="button"
              onClick={() => void openFile()}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-muted hover:bg-bg hover:text-fg"
            >
              <FilePlus size={15} />
              <span className="flex-1">{t("workspace.openFile")}</span>
            </button>
            <div className="my-1 border-t border-border" />
            <button
              type="button"
              onClick={addPreview}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-muted hover:bg-bg hover:text-fg"
            >
              <Globe size={15} />
              <span className="flex-1">{t("preview:title")}</span>
            </button>
            <button
              type="button"
              onClick={addGitGraph}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-muted hover:bg-bg hover:text-fg"
            >
              <GitBranch size={15} />
              <span className="flex-1">{t("gitGraph:title")}</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
