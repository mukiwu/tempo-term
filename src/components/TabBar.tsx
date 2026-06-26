import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileCode,
  FileText,
  GitBranch,
  Globe,
  LayoutGrid,
  PanelLeft,
  Pencil,
  Plus,
  SquareTerminal,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useTabsStore, tabHasDirtyEditor, type Tab } from "@/stores/tabsStore";
import { useEditorStore } from "@/modules/editor/store/editorStore";
import { useUiStore } from "@/stores/uiStore";
import { SpaceDropdown } from "./SpaceDropdown";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu } from "./ContextMenu";

// Module-level so the reference stays stable across renders. Passing an inline
// options object would make useSensor/useSensors return a new sensors array on
// every render, re-initializing the sensor managers (a re-render is triggered
// mid-drag when draggingId updates).
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };

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
    case "launcher":
      return LayoutGrid;
  }
}

function TabItem({ id }: { id: string }) {
  const { t } = useTranslation();
  const tab = useTabsStore((s) => s.tabs.find((x) => x.id === id));
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);
  const setTabTitle = useTabsStore((s) => s.setTabTitle);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  // A tab is dirty when any of its editor panes has unsaved changes.
  const dirty = useEditorStore((s) => {
    if (!tab) return false;
    return tabHasDirtyEditor(tab, s.buffers);
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (!tab) {
    return null;
  }
  const active = tab.id === activeId;
  const Icon = tabIcon(tab.kind);

  function startRename() {
    // `tab` is narrowed at line 80, but TS does not carry that into this
    // closure, so the guard is required to compile (same reason `commit` below
    // uses `tab &&`).
    if (!tab) {
      return;
    }
    setDraft(tab.title);
    setEditing(true);
  }

  function commit() {
    if (tab && draft.trim()) {
      setTabTitle(tab.id, draft.trim());
    }
    setEditing(false);
  }

  function requestClose() {
    if (!tab) {
      return;
    }
    if (dirty) {
      setConfirmClose(true);
    } else {
      closeTab(tab.id);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={active}
      onClick={() => setActive(tab.id)}
      onDoubleClick={startRename}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      title={tab.title}
      className={`group flex h-7 cursor-pointer items-center gap-2 rounded-md px-3 text-xs transition-colors ${
        active ? "bg-bg-elevated text-fg" : "text-fg-muted hover:bg-bg-elevated/60"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <Icon size={13} className="shrink-0" />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-28 rounded border border-accent bg-bg px-1 text-xs text-fg outline-none"
        />
      ) : (
        <span className="max-w-[160px] truncate">{tab.title}</span>
      )}
      <button
        type="button"
        aria-label={dirty ? t("editor:unsaved") : t("actions.closeTab")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          requestClose();
        }}
        className="group/close rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
      >
        {dirty ? (
          <>
            <span className="block h-3 w-3 group-hover/close:hidden">
              <span className="flex h-full w-full items-center justify-center">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
            </span>
            <span className="hidden h-3 w-3 items-center justify-center group-hover/close:flex">
              <X size={13} />
            </span>
          </>
        ) : (
          <X size={13} />
        )}
      </button>
      {confirmClose && (
        <ConfirmDialog
          title={t("editor:closeUnsavedTitle")}
          message={t("editor:closeUnsavedMessage")}
          confirmLabel={t("editor:discardClose")}
          cancelLabel={t("actions.cancel")}
          onConfirm={() => {
            setConfirmClose(false);
            closeTab(tab.id);
          }}
          onCancel={() => setConfirmClose(false)}
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              id: "rename",
              label: t("actions.renameTab"),
              icon: Pencil,
              group: 0,
              onSelect: startRename,
            },
            {
              id: "close",
              label: t("actions.closeTab"),
              icon: X,
              group: 1,
              danger: true,
              onSelect: requestClose,
            },
          ]}
        />
      )}
    </div>
  );
}

function TabOverlay({ tab }: { tab: Tab }) {
  const Icon = tabIcon(tab.kind);
  return (
    <div className="flex h-7 items-center gap-2 rounded-md bg-bg-elevated px-3 text-xs text-fg shadow-lg">
      <Icon size={13} className="shrink-0" />
      <span className="max-w-[160px] truncate">{tab.title}</span>
    </div>
  );
}

export function TabBar() {
  const { t } = useTranslation();
  const tabs = useTabsStore((s) => s.tabs);
  const activeSpaceId = useTabsStore((s) => s.activeSpaceId);
  const visibleTabs = tabs.filter((tab) => tab.spaceId === activeSpaceId);
  const openLauncherTab = useTabsStore((s) => s.openLauncherTab);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const sidebarVisible = useUiStore((s) => s.sidebarVisible);
  const reorderTab = useTabsStore((s) => s.reorderTab);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));
  const draggingTab = visibleTabs.find((tab) => tab.id === draggingId);

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderTab(String(active.id), String(over.id));
    }
  }

  function handleDragCancel() {
    setDraggingId(null);
  }

  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-bg-inset pl-20 pr-2"
    >
      <button
        type="button"
        aria-label={t("workspace.toggleSidebar")}
        title={t("workspace.toggleSidebar")}
        aria-pressed={sidebarVisible}
        onClick={toggleSidebar}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-bg-elevated ${
          sidebarVisible ? "text-fg" : "text-fg-subtle hover:text-fg"
        }`}
      >
        <PanelLeft size={16} />
      </button>
      <SpaceDropdown />
      <div className="mx-1 h-4 w-px shrink-0 bg-border" />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          data-tauri-drag-region
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          <SortableContext
            items={visibleTabs.map((tab) => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
            {visibleTabs.map((tab) => (
              <TabItem key={tab.id} id={tab.id} />
            ))}
          </SortableContext>
        </div>
        <DragOverlay>{draggingTab ? <TabOverlay tab={draggingTab} /> : null}</DragOverlay>
      </DndContext>

      <button
        type="button"
        aria-label={t("workspace.addTab")}
        title={t("workspace.addTab")}
        onClick={() => openLauncherTab()}
        className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg"
      >
        <Plus size={16} />
      </button>
    </header>
  );
}
