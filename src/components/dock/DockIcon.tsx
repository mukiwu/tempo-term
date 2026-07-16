import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { Tooltip } from "@/components/Tooltip";
import type { PanelId } from "@/stores/uiStore";
import {
  useSessionStatusStore,
  selectSessionStatus,
} from "@/modules/claude-progress/lib/sessionStatusStore";
import { PANEL_REGISTRY } from "./panelRegistry";
import { StatusStripDot } from "./StatusStripDot";

/** Common classes for a dock-strip icon button, active or not. */
function iconButtonClass(active: boolean, dragging: boolean): string {
  return `flex h-7 w-8 select-none items-center justify-center border-b-2 transition-colors ${
    active
      ? "border-accent text-fg"
      : "border-transparent text-fg-subtle hover:border-border-strong hover:text-fg"
  } ${dragging ? "opacity-30" : ""}`;
}

/**
 * One draggable dock-strip icon. The dnd-kit pointer sensor distinguishes a
 * click (activate the panel) from a drag (reorder / re-dock) via the activation
 * distance, so no manual drag-vs-click bookkeeping is needed. Pointer-based
 * dnd-kit is used rather than HTML5 drag because Tauri's native drag-drop
 * capture (needed for file drops into the terminal) swallows the webview's
 * HTML5 drag events.
 */
export function DockIcon({
  id,
  active,
  onSelect,
}: {
  id: PanelId;
  active: boolean;
  onSelect: (id: PanelId) => void;
}) {
  const { t } = useTranslation();
  const { icon: Icon, labelKey, showSessionStatus } = PANEL_REGISTRY[id];
  // Only status-bearing icons subscribe to the aggregate; the rest read a stable
  // null and never re-render when a session's status ticks.
  const status = useSessionStatusStore((s) => (showSessionStatus ? selectSessionStatus(s) : null));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
        transition,
      }}
      className="shrink-0"
      {...attributes}
      {...listeners}
      // Only the inner button is a tab stop; useSortable's attributes would
      // otherwise add a redundant tabIndex=0 here (no keyboard sensor is used).
      tabIndex={-1}
    >
      <Tooltip label={t(labelKey)} side="bottom">
        <button
          type="button"
          aria-label={t(labelKey)}
          aria-pressed={active}
          onClick={() => onSelect(id)}
          className={`relative ${iconButtonClass(active, isDragging)}`}
        >
          <Icon size={15} />
          {status && <StatusStripDot status={status} />}
        </button>
      </Tooltip>
    </div>
  );
}
