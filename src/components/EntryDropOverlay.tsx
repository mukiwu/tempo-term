import type { DropZone } from "@/modules/terminal/lib/terminalLayout";
import type { SplitDirection } from "@/modules/terminal/lib/terminalLayout";

const BASE = "absolute z-30 border-2 border-dashed pointer-events-none";

function colorClass(ok: boolean): string {
  return ok ? "border-accent/60 bg-accent/[0.07]" : "border-danger/40 bg-danger/[0.04]";
}

/**
 * The drop-zone outline shown inside the hovered pane itself: a full block
 * for center (or when no zone has resolved yet), or a narrow strip on the
 * relevant edge for an individual split zone. Outer-scope zones are NOT
 * rendered here — see `outerBandOverlayClassName`, rendered once across the
 * whole pane area instead of inside any single pane's div.
 */
export function dropOverlayClassName(zone: DropZone | null, ok: boolean): string {
  const color = colorClass(ok);
  if (!zone || zone.kind === "center" || zone.scope === "outer") {
    return `${BASE} inset-0 ${color}`;
  }
  if (zone.direction === "col") {
    return zone.anchor === "before"
      ? `${BASE} inset-x-0 top-0 h-1/4 ${color}`
      : `${BASE} inset-x-0 bottom-0 h-1/4 ${color}`;
  }
  return zone.anchor === "before"
    ? `${BASE} inset-y-0 left-0 w-1/4 ${color}`
    : `${BASE} inset-y-0 right-0 w-1/4 ${color}`;
}

/**
 * The drop-zone outline for an outer-scope zone: a band spanning the whole
 * pane area along its near edge, always the "allowed" color since there is
 * no source that can't be dropped there.
 */
export function outerBandOverlayClassName(direction: SplitDirection, anchor: "before" | "after"): string {
  const color = colorClass(true);
  if (direction === "row") {
    return anchor === "before"
      ? `${BASE} inset-y-0 left-0 w-[12%] ${color}`
      : `${BASE} inset-y-0 right-0 w-[12%] ${color}`;
  }
  return anchor === "before"
    ? `${BASE} inset-x-0 top-0 h-[12%] ${color}`
    : `${BASE} inset-x-0 bottom-0 h-[12%] ${color}`;
}
