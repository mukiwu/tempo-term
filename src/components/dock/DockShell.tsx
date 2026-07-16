import { useState } from "react";
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
import { TabsArea } from "@/components/TabsArea";
import { Resizer } from "@/components/Resizer";
import { useUiStore, type DockSide, type PanelId } from "@/stores/uiStore";
import { PANEL_REGISTRY } from "./panelRegistry";
import { DockColumn } from "./DockColumn";

// Module-level so the reference stays stable across renders (a mid-drag render
// happens when draggingId updates). The 4px activation distance keeps a plain
// click (activate the panel) from starting a drag.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 4 } };

/** Width of an emptied dock column's thin drop strip (px). */
const EMPTY_STRIP_W = 44;

/**
 * The body shell: left dock column | center tabs | right dock column, wrapped in
 * a single DndContext so a panel icon can be dragged between the two columns.
 * Dropping over an icon inserts at that position; dropping elsewhere in a column
 * re-docks to that side. The commit happens once on drag end (no mid-drag store
 * writes) to avoid the classic flicker / snap-back.
 */
export function DockShell() {
  const panelOrder = useUiStore((s) => s.panelOrder);
  const visible = useUiStore((s) => s.visible);
  const width = useUiStore((s) => s.width);

  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));
  const [draggingId, setDraggingId] = useState<PanelId | null>(null);
  const DraggingIcon = draggingId ? PANEL_REGISTRY[draggingId].icon : null;

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(event.active.id as PanelId);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over) {
      return;
    }
    const id = active.id as PanelId;
    const overId = String(over.id);
    const store = useUiStore.getState();
    const fromSide: DockSide = store.panelOrder.left.includes(id) ? "left" : "right";

    // `over` is either a side container (id === "left"|"right") or a panel icon.
    const toSide: DockSide =
      overId === "left" || overId === "right"
        ? overId
        : store.panelOrder.left.includes(overId as PanelId)
          ? "left"
          : "right";

    if (toSide === fromSide) {
      const orderArr = store.panelOrder[fromSide];
      const from = orderArr.indexOf(id);
      const to =
        overId === fromSide
          ? orderArr.length - 1 // dropped on empty strip space → move to the end
          : orderArr.indexOf(overId as PanelId);
      if (from !== -1 && to !== -1 && from !== to) {
        store.reorderWithinSide(fromSide, from, to);
      }
    } else {
      const toIndex =
        overId === toSide
          ? store.panelOrder[toSide].length // dropped on the column, not an icon → append
          : store.panelOrder[toSide].indexOf(overId as PanelId);
      store.movePanel(id, toSide, toIndex < 0 ? store.panelOrder[toSide].length : toIndex);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <div className="flex min-h-0 flex-1">
        <div
          className="h-full shrink-0"
          style={{ width: panelOrder.left.length ? width.left : EMPTY_STRIP_W }}
          hidden={!visible.left}
        >
          <DockColumn side="left" />
        </div>
        {visible.left && panelOrder.left.length > 0 && (
          <Resizer
            orientation="vertical"
            onResize={(d) => {
              const s = useUiStore.getState();
              s.setSideWidth("left", s.width.left + d);
            }}
          />
        )}

        <main className="min-w-0 flex-1 overflow-hidden">
          <TabsArea />
        </main>

        {visible.right && panelOrder.right.length > 0 && (
          <Resizer
            orientation="vertical"
            onResize={(d) => {
              const s = useUiStore.getState();
              s.setSideWidth("right", s.width.right - d);
            }}
          />
        )}
        <div
          className="h-full shrink-0"
          style={{ width: panelOrder.right.length ? width.right : EMPTY_STRIP_W }}
          hidden={!visible.right}
        >
          <DockColumn side="right" />
        </div>
      </div>

      <DragOverlay>
        {DraggingIcon ? (
          <span
            aria-hidden
            className="flex h-7 w-8 items-center justify-center rounded-md border border-border-strong bg-bg-elevated text-fg shadow-lg"
          >
            <DraggingIcon size={15} />
          </span>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
