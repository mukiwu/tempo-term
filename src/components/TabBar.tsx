import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileCode,
  FileText,
  GitBranch,
  GitCompare,
  Globe,
  History,
  Image,
  LayoutGrid,
  PanelLeft,
  PanelRight,
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
    case "media":
      return Image;
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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
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
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        transition,
      }}
      {...attributes}
      {...listeners}
      role="tab"
      data-tab-id={id}
      aria-selected={active}
      onClick={() => setActive(tab.id)}
      onDoubleClick={startRename}
      onAuxClick={(e) => {
        // Middle-click closes the tab (browser/editor convention). Routed
        // through requestClose so a dirty editor still gets its confirm dialog.
        if (e.button === 1) {
          e.preventDefault();
          requestClose();
        }
      }}
      onContextMenu={(e) => {
        // Right-clicks on the rename input skip the tab menu and bubble to the
        // window-level InputContextMenu, like every other text field.
        if (e.target instanceof HTMLInputElement) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      // Active indicator: a 10% accent fill flush with the bar (the tab
      // stretches the bar's full content height, square corners) and an accent
      // underline sitting right on the bar's bottom border. Font-weight is
      // deliberately left untouched — labels render in the proportional Inter
      // font, so a bold/regular swap would jostle tab widths on every
      // activation.
      className={`group relative flex cursor-pointer items-center gap-2 px-3 text-xs transition-colors ${
        active
          ? "bg-accent/10 text-fg"
          : "text-fg-muted hover:bg-bg-elevated/60"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[2px] bg-accent"
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
      {/*
        Always labelled, and the only close button in the window that hovers to
        danger. A split tab also shows a close button in each pane header one
        row below; that one used to be the ✕-shaped red one even though it just
        peels off a split, while this ✕ — which drops the whole tab, shells and
        all, with no undo — hovered to plain grey. The weight now matches the
        cost, and the tooltip names which is which.
      */}
      <Tooltip
        label={dirty ? t("editor:unsaved") : t("actions.closeTab")}
        side="bottom"
      >
        <button
          type="button"
          aria-label={dirty ? t("editor:unsaved") : t("actions.closeTab")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            requestClose();
          }}
          className="group/close rounded p-0.5 text-fg-subtle hover:bg-danger/15 hover:text-danger"
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
      className="h-7 w-0.5 shrink-0 self-center rounded-full bg-accent"
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

/**
 * Wheel distance, in pixels, that steps one tab across with Shift held. One
 * mouse notch is 100 on both platforms, so a notch is a tab; a trackpad's finer
 * deltas accumulate up to it, walking the tabs one at a time instead of flying
 * past them.
 */
const TAB_STEP_DELTA = 100;

/** A wheel event's delta in pixels, whatever unit the device reports it in. */
function wheelPixels(event: WheelEvent, viewport: number): number {
  const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return delta * 16;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return delta * viewport;
  }
  return delta;
}

export function TabBar() {
  const { t } = useTranslation();
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const activeSpaceId = useTabsStore((s) => s.activeSpaceId);
  const visibleTabs = tabs.filter((tab) => tab.spaceId === activeSpaceId);
  const openLauncherTab = useTabsStore((s) => s.openLauncherTab);
  const toggleSide = useUiStore((s) => s.toggleSide);
  const leftVisible = useUiStore((s) => s.visible.left);
  const rightVisible = useUiStore((s) => s.visible.right);
  const openFileFinder = useUiStore((s) => s.openFileFinder);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const canSearchFiles = canSearchRoot(rootPath);
  const reorderTab = useTabsStore((s) => s.reorderTab);
  const entryTabBarHover = useEntryDragStore((s) => s.tabBarHover);
  const noteTabBarHover = useNoteDragStore((s) => s.tabBarHover);
  const sshTabBarHover = useSshDragStore((s) => s.tabBarHover);
  const tabBarHover =
    entryTabBarHover ?? noteTabBarHover ?? sshTabBarHover ?? null;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));
  const draggingTab = visibleTabs.find((tab) => tab.id === draggingId);
  const stripRef = useRef<HTMLDivElement>(null);

  // The strip's own scrollbar is hidden, so a tab past either edge would be
  // reachable by the wheel alone. Activating one — Ctrl+Tab, a new tab, a file
  // opened from the explorer — brings it in, by the shortest distance that
  // makes it whole, leaving an already-visible tab exactly where it is.
  //
  // Positioned by hand rather than with scrollIntoView: WKWebView's is
  // unreliable inside nested scroll containers (see NoteToc), and it would also
  // be free to scroll ancestors, which here means yanking the whole shell
  // sideways. Rects, not offsetLeft — the strip is not a positioned ancestor.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !activeId) {
      return;
    }
    const tab = strip.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeId)}"]`,
    );
    if (!tab) {
      return;
    }
    const stripBox = strip.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    if (tabBox.left < stripBox.left) {
      strip.scrollLeft -= stripBox.left - tabBox.left;
    } else if (tabBox.right > stripBox.right) {
      strip.scrollLeft += tabBox.right - stripBox.right;
    }
  }, [activeId]);

  // A plain wheel scrolls the strip sideways — the browser only does that by
  // itself once the strip can scroll nothing else, and here it can (the tabs
  // stretch it to the row's full height), so it is done explicitly. Shift+wheel
  // steps through the tabs instead, which is worth more on a bar than the
  // sideways scroll Shift normally means.
  //
  // Registered by hand because React marks wheel listeners passive, and both
  // branches have to cancel the default. Tab state is read at event time, so
  // this attaches once instead of on every tab change.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      return;
    }
    let pending = 0;
    const step = (direction: 1 | -1) => {
      const state = useTabsStore.getState();
      const spaceTabs = state.tabs.filter(
        (tab) => tab.spaceId === state.activeSpaceId,
      );
      const index = spaceTabs.findIndex((tab) => tab.id === state.activeId);
      const next = index === -1 ? undefined : spaceTabs[index + direction];
      // Stops at either end rather than wrapping: a wheel has no detent to
      // tell you that you just crossed from the last tab back to the first.
      if (next) {
        state.setActive(next.id);
      }
    };
    const onWheel = (event: WheelEvent) => {
      const delta = wheelPixels(event, strip.clientWidth);
      if (delta === 0) {
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        // Reset on a reversal so a direction change takes effect immediately
        // instead of first paying off the distance built up the other way.
        pending =
          Math.sign(pending) === -Math.sign(delta) ? delta : pending + delta;
        // Direction comes from the accumulated distance, not from what is left
        // after a step is paid out — a leftover of 0 would read as forwards.
        const direction = pending > 0 ? 1 : -1;
        while (Math.abs(pending) >= TAB_STEP_DELTA) {
          pending -= direction * TAB_STEP_DELTA;
          step(direction);
        }
        return;
      }
      // A trackpad's own sideways swipe already arrives as deltaX; leave it be.
      if (event.deltaX !== 0) {
        return;
      }
      event.preventDefault();
      strip.scrollLeft += delta;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

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
      <Tooltip
        label={t("workspace.toggleSidebar")}
        side="bottom"
        className="shrink-0"
      >
        <button
          type="button"
          aria-label={t("workspace.toggleSidebar")}
          aria-pressed={leftVisible}
          onClick={() => toggleSide("left")}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-bg-elevated ${
            leftVisible ? "text-fg" : "text-fg-subtle hover:text-fg"
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
        {/* data-tab-bar is the drop target the drag stores resolve against, so
            it spans the strip and the slack beside it, exactly as it did when
            the strip filled the row. The strip itself only takes the width its
            tabs need, which leaves the add button sitting right after the last
            one until they overflow — then the strip shrinks and scrolls
            underneath, and the button stays put without needing a backdrop of
            its own to hide them behind. */}
        <div
          data-tab-bar
          className="flex min-w-0 flex-1 items-stretch gap-1 self-stretch"
        >
          <div
            ref={stripRef}
            // The hairline scrollbar in index.css keys off this value, and
            // every platform gets it. Windows and Linux draw a classic bar with
            // real height that squashed a 36px row, which is what the hairline
            // replaced. macOS was left on its native overlay bar because that
            // one is thin, transient and free of layout cost — but only in the
            // default "show scroll bars when scrolling" mode. Set the system
            // preference to "Always" and WKWebView draws the same classic bar
            // this rule exists to avoid, parked under the tab labels. The
            // hairline is the thinner answer in both modes: WKWebView keeps
            // fading it in and out with the overlay behaviour, and the
            // always-on mode gets 3px instead of a full-height bar.
            data-tab-strip="hairline"
            // No data-tauri-drag-region here, unlike before: Tauri swallows
            // mousedown on a drag region to start moving the window, and the
            // strip's own scrollbar is part of this element, so its thumb could
            // never be dragged. The slack beside the strip carries the drag
            // region instead, which is the part of the row that was ever worth
            // grabbing — the tabs themselves were never draggable-by-window.
            onMouseDown={(e) => {
              // Once the strip overflows it is a scroll container, and Chromium
              // answers a middle-click on one with autoscroll — swallowing the
              // auxclick a tab's close-on-middle-click needs. Cancelling the
              // default here covers the tabs and the empty space alike; auxclick
              // fires on mouseup, so it still arrives.
              if (e.button === 1) {
                e.preventDefault();
              }
            }}
            // items-stretch, inside a parent that stretches too, lets tabs fill
            // the bar's content height, so the active fill and underline sit
            // flush against the bar's bottom border.
            //
            // Windows renders a classic scrollbar here, which takes real height
            // out of a 36px row and squashes every tab to make room — the same
            // reason the editor and diff views proxy their scrollbars (#327).
            // index.css restyles this one strip down to a 3px hairline (the
            // data-tab-strip attribute is the hook). The wheel scrolls it too: a
            // vertical wheel over a horizontally-only scrollable box scrolls it
            // sideways.
            className="flex min-w-0 shrink items-stretch gap-1 overflow-x-auto"
          >
            <SortableContext
              items={visibleTabs.map((tab) => tab.id)}
              strategy={horizontalListSortingStrategy}
            >
              {visibleTabs.map((tab) => (
                <Fragment key={tab.id}>
                  {tabBarHover?.insertBeforeId === tab.id && (
                    <TabInsertionLine />
                  )}
                  <TabItem id={tab.id} />
                </Fragment>
              ))}
            </SortableContext>
            {tabBarHover !== null && tabBarHover.insertBeforeId === null && (
              <TabInsertionLine />
            )}
          </div>
          <Tooltip
            label={t("workspace.addTab")}
            side="bottom"
            className="shrink-0 self-center"
          >
            <button
              type="button"
              aria-label={t("workspace.addTab")}
              onClick={() => openLauncherTab()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg"
            >
              <Plus size={16} />
            </button>
          </Tooltip>
          {/* The slack the strip used to hold: still part of the drop target,
            still a place to grab the window by. */}
          <div data-tauri-drag-region className="min-w-0 flex-1 self-stretch" />
        </div>
        <DragOverlay>
          {draggingTab ? <TabOverlay tab={draggingTab} /> : null}
        </DragOverlay>
      </DndContext>
      <Tooltip
        label={t("explorer:findFiles")}
        side="bottom"
        className="shrink-0"
      >
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
      <Tooltip
        label={t("workspace.toggleRightSidebar")}
        side="bottom"
        className="shrink-0"
      >
        <button
          type="button"
          aria-label={t("workspace.toggleRightSidebar")}
          aria-pressed={rightVisible}
          onClick={() => toggleSide("right")}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-bg-elevated ${
            rightVisible ? "text-fg" : "text-fg-subtle hover:text-fg"
          }`}
        >
          <PanelRight size={16} />
        </button>
      </Tooltip>
    </header>
  );
}
