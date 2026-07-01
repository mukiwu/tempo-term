/**
 * Pointer-based drag for an SSH connection row, onto a pane (or, from Phase
 * 4's tab-bar addition, the tab bar). Same avoid-native-HTML5-drag reasoning
 * as `dragEntry.ts`/`noteDrag.ts`: Tauri intercepts native drag events at the
 * webview layer, so this tracks pointer events directly instead. Unlike
 * files or notes, an SSH connection has no sidebar-internal drop target (no
 * "move it to a folder") — it only ever targets a pane or the tab bar.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";

interface SshDragState {
  /** The pane under the cursor and the pointer's percentage position within it. */
  paneHover: { leafId: string; xPct: number; yPct: number } | null;
  /** A resolved pane drop waiting for its owning tab to consume it. */
  pendingPaneDrop:
    | { leafId: string; connectionId: string; connectionName: string; xPct: number; yPct: number }
    | null;
  clearPendingPaneDrop: () => void;
}

export const useSshDragStore = create<SshDragState>((set) => ({
  paneHover: null,
  pendingPaneDrop: null,
  clearPendingPaneDrop: () => set({ pendingPaneDrop: null }),
}));

const DRAG_THRESHOLD = 5;

// A click fires right after a drag's pointerup; this lets the source row
// swallow that one click so finishing a drag doesn't also open the connection.
let suppressClick = false;
export function consumeSshDragClick(): boolean {
  if (!suppressClick) {
    return false;
  }
  suppressClick = false;
  return true;
}

let ghostEl: HTMLDivElement | null = null;

function showGhost(label: string, x: number, y: number): void {
  const el = document.createElement("div");
  el.textContent = label;
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

function leafAt(x: number, y: number): string | null {
  return (
    document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pane-leaf]")?.dataset.paneLeaf ?? null
  );
}

function pointerToPaneAreaPct(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { xPct: number; yPct: number } {
  const xPct = rect.width > 0 ? ((clientX - rect.left) / rect.width) * 100 : 0;
  const yPct = rect.height > 0 ? ((clientY - rect.top) / rect.height) * 100 : 0;
  return { xPct: Math.min(100, Math.max(0, xPct)), yPct: Math.min(100, Math.max(0, yPct)) };
}

function paneAreaRectAt(x: number, y: number): DOMRect | null {
  return (
    document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pane-area]")?.getBoundingClientRect() ??
    null
  );
}

/**
 * Begin a pointer drag of an SSH connection. Tracks the cursor with pointer
 * events, follows it with a ghost label, highlights the pane underneath, and
 * on release resolves the drop into the store for the owning pane to consume.
 */
export function beginSshDrag(
  connectionId: string,
  connectionName: string,
  event: ReactPointerEvent,
): void {
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
      showGhost(connectionName, e.clientX, e.clientY);
    }
    moveGhost(e.clientX, e.clientY);
    const leafId = leafAt(e.clientX, e.clientY);
    const areaRect = paneAreaRectAt(e.clientX, e.clientY);
    useSshDragStore.setState({
      paneHover: leafId && areaRect ? { leafId, ...pointerToPaneAreaPct(areaRect, e.clientX, e.clientY) } : null,
    });
  };

  const onUp = (e: PointerEvent) => {
    stop();
    if (!active) {
      return;
    }
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    const leafId = leafAt(e.clientX, e.clientY);
    const areaRect = paneAreaRectAt(e.clientX, e.clientY);
    const pct = areaRect ? pointerToPaneAreaPct(areaRect, e.clientX, e.clientY) : { xPct: 0, yPct: 0 };
    useSshDragStore.setState({
      paneHover: null,
      pendingPaneDrop: leafId ? { leafId, connectionId, connectionName, ...pct } : null,
    });
  };

  const onCancel = () => {
    stop();
    useSshDragStore.setState({ paneHover: null });
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}
