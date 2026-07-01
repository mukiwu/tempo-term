/**
 * Pointer-based drag of an explorer entry onto a pane. We deliberately avoid
 * HTML5 drag-and-drop: Tauri intercepts it at the native layer when
 * `dragDropEnabled` is on, which makes elementFromPoint and event coordinates
 * unreliable mid-drag (flaky hover, wrong drop target). Pointer events sidestep
 * that entirely, so the cursor position stays exact.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";
import { useTabsStore } from "@/stores/tabsStore";

export interface DraggedEntry {
  path: string;
  name: string;
  isDir: boolean;
}

interface PendingDrop {
  leafId: string;
  entry: DraggedEntry;
  xPct: number;
  yPct: number;
}

interface EntryDragState {
  /** The entry being dragged, or null when no drag is in flight. */
  entry: DraggedEntry | null;
  /** True once a pointer drag passes the start threshold. */
  dragging: boolean;
  /** Leaf id of the pane under the cursor, for the drop highlight. */
  hoverLeafId: string | null;
  /** The pointer's live position, as a percentage of the pane-area container
   * under it, for resolving the live drop-zone highlight while dragging. */
  hoverPointerPct: { xPct: number; yPct: number } | null;
  /** A resolved drop waiting for its owning pane to consume it. */
  pendingDrop: PendingDrop | null;
  setHover: (leafId: string | null) => void;
  clearPendingDrop: () => void;
}

export const useEntryDragStore = create<EntryDragState>((set) => ({
  entry: null,
  dragging: false,
  hoverLeafId: null,
  hoverPointerPct: null,
  pendingDrop: null,
  setHover: (leafId) => set((s) => (s.hoverLeafId === leafId ? s : { hoverLeafId: leafId })),
  clearPendingDrop: () => set({ pendingDrop: null }),
}));

/** The entry currently being dragged, read synchronously (e.g. by drop guards). */
export function getDraggedEntry(): DraggedEntry | null {
  return useEntryDragStore.getState().entry;
}

export function setDraggedEntry(entry: DraggedEntry | null): void {
  useEntryDragStore.setState({ entry });
}

const DRAG_THRESHOLD = 5;

// A click fires right after a drag's pointerup; this lets the source row swallow
// that one click so finishing a drag doesn't also open/expand the entry.
let suppressClick = false;
export function consumeDragClick(): boolean {
  if (!suppressClick) {
    return false;
  }
  suppressClick = false;
  return true;
}

/** The leaf id of the pane under a client point, or null. */
function leafAt(x: number, y: number): string | null {
  return (
    document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pane-leaf]")?.dataset.paneLeaf ??
    null
  );
}

/** Convert a client point into a 0-100 percentage of `rect`, clamped at the edges. */
export function pointerToPaneAreaPct(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { xPct: number; yPct: number } {
  const xPct = rect.width > 0 ? ((clientX - rect.left) / rect.width) * 100 : 0;
  const yPct = rect.height > 0 ? ((clientY - rect.top) / rect.height) * 100 : 0;
  return {
    xPct: Math.min(100, Math.max(0, xPct)),
    yPct: Math.min(100, Math.max(0, yPct)),
  };
}

/** The pane-area container rect under a client point, or null. */
function paneAreaRectAt(x: number, y: number): DOMRect | null {
  return (
    document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pane-area]")?.getBoundingClientRect() ??
    null
  );
}

/** True when `el` (or an ancestor) is the tab bar — takes priority over any pane target. */
export function isOverTabBar(el: Element | null): boolean {
  return el?.closest("[data-tab-bar]") != null;
}

let ghostEl: HTMLDivElement | null = null;

function showGhost(label: string, x: number, y: number): void {
  const el = document.createElement("div");
  el.textContent = label;
  // pointer-events:none is essential — otherwise the ghost would sit under the
  // cursor and elementFromPoint would resolve to it instead of the pane.
  el.style.cssText =
    "position:fixed;left:0;top:0;z-index:9999;pointer-events:none;padding:2px 8px;" +
    "border-radius:6px;font-size:12px;white-space:nowrap;" +
    "background:var(--color-bg-elevated);color:var(--color-fg);" +
    "border:1px solid var(--color-border-strong);box-shadow:0 4px 12px rgba(0,0,0,0.3);";
  document.body.appendChild(el);
  ghostEl = el;
  moveGhost(x, y);
}

function moveGhost(x: number, y: number): void {
  if (ghostEl) {
    ghostEl.style.transform = `translate(${x + 12}px, ${y + 8}px)`;
  }
}

function removeGhost(): void {
  ghostEl?.remove();
  ghostEl = null;
}

/**
 * Begin a pointer drag of an explorer entry. Tracks the cursor with pointer
 * events, follows it with a ghost label, highlights the pane underneath, and on
 * release resolves the drop target into the store for the owning pane to handle.
 */
export function beginEntryDrag(entry: DraggedEntry, event: ReactPointerEvent): void {
  if (event.button !== 0) {
    return;
  }
  const startX = event.clientX;
  const startY = event.clientY;
  let active = false;

  const stop = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    removeGhost();
    document.body.style.userSelect = "";
  };

  const onMove = (e: PointerEvent) => {
    if (!active) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) {
        return;
      }
      active = true;
      document.body.style.userSelect = "none";
      useEntryDragStore.setState({ entry, dragging: true });
      showGhost(entry.name, e.clientX, e.clientY);
    }
    moveGhost(e.clientX, e.clientY);
    useEntryDragStore.getState().setHover(leafAt(e.clientX, e.clientY));
    const areaRect = paneAreaRectAt(e.clientX, e.clientY);
    useEntryDragStore.setState({
      hoverPointerPct: areaRect ? pointerToPaneAreaPct(areaRect, e.clientX, e.clientY) : null,
    });
  };

  const onUp = (e: PointerEvent) => {
    stop();
    if (!active) {
      return;
    }
    suppressClick = true;
    // Safety net in case no click follows this drag.
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    if (isOverTabBar(document.elementFromPoint(e.clientX, e.clientY))) {
      useEntryDragStore.setState({
        dragging: false,
        hoverLeafId: null,
        hoverPointerPct: null,
        entry: null,
        pendingDrop: null,
      });
      if (!entry.isDir) {
        useTabsStore.getState().openInNewTab({ kind: "editor", path: entry.path });
      }
      return;
    }
    const leafId = leafAt(e.clientX, e.clientY);
    const areaRect = paneAreaRectAt(e.clientX, e.clientY);
    const { xPct, yPct } = areaRect
      ? pointerToPaneAreaPct(areaRect, e.clientX, e.clientY)
      : { xPct: 0, yPct: 0 };
    useEntryDragStore.setState({
      dragging: false,
      hoverLeafId: null,
      hoverPointerPct: null,
      entry: null,
      pendingDrop: leafId ? { leafId, entry, xPct, yPct } : null,
    });
  };

  const onCancel = () => {
    stop();
    useEntryDragStore.setState({ dragging: false, hoverLeafId: null, hoverPointerPct: null, entry: null });
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}

/** Quote a path for a shell only when it contains characters that need it. */
export function shellQuotePath(path: string): string {
  if (/^[\w@%+=:,./-]+$/.test(path)) {
    return path;
  }
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/** A Markdown link `[name](path)` for dropping an entry into a note. */
export function markdownLink(name: string, path: string): string {
  return `[${name}](${path})`;
}

/** A file:// URL for showing a dropped file in the web preview. */
export function fileUrl(path: string): string {
  return `file://${path}`;
}
