import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileCode,
  FileText,
  GitBranch,
  GitCompare,
  Globe,
  History,
  LayoutGrid,
  PanelLeft,
  Plus,
  Search,
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
import { useTabsStore, type Tab } from "@/stores/tabsStore";
import { Tooltip } from "@/components/Tooltip";
import { useTabCloseRequest } from "./useTabCloseRequest";
import { useUiStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { IS_MAC } from "@/lib/platform";
import { SpaceDropdown } from "./SpaceDropdown";
import { ContextMenu } from "./ContextMenu";
import { tabContextMenuItems } from "./tabContextMenuItems";
import { useEntryDragStore } from "@/modules/explorer/lib/dragEntry";
import { useNoteDragStore } from "@/modules/notes/lib/noteDrag";
import { useSshDragStore } from "@/modules/ssh/lib/sshDrag";
import { canSearchRoot } from "@/modules/explorer/lib/fsBridge";

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
    case "diff":
      return GitCompare;
    case "sessions":
      return History;
    case "launcher":
      return LayoutGrid;
  }
}

function TabItem({ id }: { id: string }) {
  const { t } = useTranslation();
  const tab = useTabsStore((s) => s.tabs.find((x) => x.id === id));
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const setTabTitle = useTabsStore((s) => s.setTabTitle);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const { dirty, requestClose, confirmCloseDialog } = useTabCloseRequest(tab);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
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
      data-tab-id={id}
      aria-selected={active}
      onClick={() => setActive(tab.id)}
      onDoubleClick={startRename}
      onContextMenu={(e) => {
        // Right-clicks on the rename input skip the tab menu and bubble to the
        // window-level InputContextMenu, like every other text field.
        if (e.target instanceof HTMLInputElement) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      // Minimal-weight active indicator: a small accent dot at the leading
      // edge plus full-opacity text, no border/fill/bold. `pl-4` (vs. `pr-3`)
      // is reserved on every tab, active or not, so the dot never shifts the
      // icon/label position when a tab activates. Font-weight is deliberately
      // left untouched — labels render in the proportional Inter font, so a
      // bold/regular swap would jostle tab widths on every activation.
      className={`group relative flex h-7 cursor-pointer items-center gap-2 rounded-md border border-transparent pl-4 pr-3 text-xs transition-colors ${
        active ? "text-fg" : "text-fg-muted hover:bg-bg-elevated/60"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent"
        />
      )}
      <Icon size={13} className="shrink-0" />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-28 rounded border border-accent bg-bg px-1 text-xs text-fg outline-none"
        />
      ) : (
        <Tooltip label={tab.title} side="bottom" className="min-w-0">
          <span className="max-w-[160px] truncate">{tab.title}</span>
        </Tooltip>
      )}
      {/* The ✕ glyph is self-explanatory; only the dirty dot needs a hint. */}
      <Tooltip label={dirty ? t("editor:unsaved") : undefined} side="bottom">
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
      </Tooltip>
      {confirmCloseDialog}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={tabContextMenuItems(t, {
            onRename: startRename,
            onClose: requestClose,
          })}
        />
      )}
    </div>
  );
}

function TabInsertionLine() {
  return (
    <div
      aria-hidden
      data-testid="tab-insertion-line"
      className="h-7 w-0.5 shrink-0 rounded-full bg-accent"
    />
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
  const openFileFinder = useUiStore((s) => s.openFileFinder);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const canSearchFiles = canSearchRoot(rootPath);
  const reorderTab = useTabsStore((s) => s.reorderTab);
  const entryTabBarHover = useEntryDragStore((s) => s.tabBarHover);
  const noteTabBarHover = useNoteDragStore((s) => s.tabBarHover);
  const sshTabBarHover = useSshDragStore((s) => s.tabBarHover);
  const tabBarHover = entryTabBarHover ?? noteTabBarHover ?? sshTabBarHover ?? null;
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
      className={`flex h-9 shrink-0 items-center gap-1 border-b border-border bg-bg-inset pr-2 ${
        IS_MAC ? "pl-20" : "pl-3"
      }`}
    >
      <Tooltip label={t("workspace.toggleSidebar")} side="bottom" className="shrink-0">
        <button
          type="button"
          aria-label={t("workspace.toggleSidebar")}
          aria-pressed={sidebarVisible}
          onClick={toggleSidebar}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-bg-elevated ${
            sidebarVisible ? "text-fg" : "text-fg-subtle hover:text-fg"
          }`}
        >
          <PanelLeft size={16} />
        </button>
      </Tooltip>
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
          data-tab-bar
          data-tauri-drag-region
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          <SortableContext
            items={visibleTabs.map((tab) => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
            {visibleTabs.map((tab) => (
              <Fragment key={tab.id}>
                {tabBarHover?.insertBeforeId === tab.id && <TabInsertionLine />}
                <TabItem id={tab.id} />
              </Fragment>
            ))}
          </SortableContext>
          {tabBarHover !== null && tabBarHover.insertBeforeId === null && <TabInsertionLine />}
          <Tooltip label={t("workspace.addTab")} side="bottom" className="shrink-0">
            <button
              type="button"
              aria-label={t("workspace.addTab")}
              onClick={() => openLauncherTab()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg"
            >
              <Plus size={16} />
            </button>
          </Tooltip>
        </div>
        <DragOverlay>{draggingTab ? <TabOverlay tab={draggingTab} /> : null}</DragOverlay>
      </DndContext>
      <Tooltip label={t("explorer:findFiles")} side="bottom" className="shrink-0">
        <button
          type="button"
          aria-label={t("explorer:findFiles")}
          disabled={!canSearchFiles}
          onClick={openFileFinder}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg disabled:pointer-events-none disabled:opacity-40"
        >
          <Search size={15} />
        </button>
      </Tooltip>
    </header>
  );
}
