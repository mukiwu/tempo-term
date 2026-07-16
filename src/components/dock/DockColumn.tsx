import { useDroppable } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useUiStore, type DockSide, type PanelId } from "@/stores/uiStore";
import { probeStart } from "@/lib/perfProbe";
import { PANEL_REGISTRY } from "./panelRegistry";
import { DockIcon } from "./DockIcon";

/**
 * One dock column (left or right): an icon-switcher strip at the top and the
 * active panel's body below. The whole column is a drop target (id === side) so
 * an icon dragged from the other column re-docks here, and an emptied column
 * still accepts a drop. The shared DndContext + DragOverlay live in DockShell;
 * this component only registers the column as droppable and its icons as
 * sortables.
 */
export function DockColumn({ side }: { side: DockSide }) {
  const order = useUiStore((s) => s.panelOrder[side]);
  const active = useUiStore((s) => s.activePanel[side]);
  const visible = useUiStore((s) => s.visible[side]);
  const activatePanel = useUiStore((s) => s.activatePanel);
  const { setNodeRef, isOver } = useDroppable({ id: side });

  const borderClass = side === "left" ? "border-r" : "border-l";
  const overRing = isOver ? "ring-1 ring-inset ring-accent/40" : "";

  function handleSelect(id: PanelId) {
    if (id === "workspaces") {
      probeStart();
    }
    activatePanel(id);
  }

  // A side emptied of panels keeps a thin strip so panels can be dropped back.
  if (order.length === 0) {
    return (
      <div
        ref={setNodeRef}
        className={`flex h-full w-full justify-center ${borderClass} border-border bg-bg-inset pt-2 ${overRing} ${
          isOver ? "text-fg" : "text-fg-subtle"
        }`}
      >
        <Plus size={14} />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex h-full w-full flex-col overflow-hidden ${borderClass} border-border bg-bg-inset ${overRing}`}
    >
      {/* overflow-x-auto so a column packed with more icons than fit stays
          reachable (native overlay scrollbar, per index.css). The wheel handler
          lets a vertical mouse wheel scroll the strip horizontally too. */}
      <div
        onWheel={(e) => {
          const el = e.currentTarget;
          if (el.scrollWidth <= el.clientWidth) return;
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            el.scrollLeft += e.deltaY;
          }
        }}
        className="relative flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-1.5"
      >
        <SortableContext items={order} strategy={horizontalListSortingStrategy}>
          {order.map((id) => (
            <DockIcon key={id} id={id} active={active === id} onSelect={handleSelect} />
          ))}
        </SortableContext>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {order.map((id) => {
          const { Component, mountAlways } = PANEL_REGISTRY[id];
          if (mountAlways) {
            // Stays mounted, just hidden, to preserve its cached state even when
            // the column is collapsed.
            return (
              <div key={id} className="h-full w-full" hidden={active !== id || !visible}>
                <Component />
              </div>
            );
          }
          // Others unmount when inactive or when the column is collapsed, so a
          // background poller (e.g. Ports) stops while hidden.
          return active === id && visible ? (
            <div key={id} className="h-full w-full">
              <Component />
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}
