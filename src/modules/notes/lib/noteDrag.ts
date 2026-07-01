/**
 * Pointer-based drag for the notes sidebar. We deliberately avoid HTML5
 * drag-and-drop: Tauri intercepts it at the native layer when `dragDropEnabled`
 * is on (needed so the terminal can receive OS file drops), which kills the
 * webview's own drag events. Pointer events aren't intercepted, so moving notes
 * between folders keeps working. A note's identity is its absolute file path.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";
import { useNotesStore } from "@/stores/notesStore";
import { useTabsStore } from "@/stores/tabsStore";

/** Where a dragged note will land when released: a sidebar folder/root (moves the note), or a pane (opens the note there). */
export type NoteDropTarget =
  | { kind: "folder"; path: string }
  | { kind: "root"; path: string }
  | { kind: "pane"; leafId: string };

/**
 * Resolve what the cursor is over (the element under the pointer) to a drop
 * target: a folder (`data-folder-path`), the root container
 * (`data-notes-root` carrying the root path), or a terminal pane
 * (`data-pane-leaf`). A folder or root (sidebar) always wins over a pane.
 */
export function resolveNoteDrop(el: Element | null): NoteDropTarget | null {
  const folder = el?.closest<HTMLElement>("[data-folder-path]");
  if (folder?.dataset.folderPath) {
    return { kind: "folder", path: folder.dataset.folderPath };
  }
  const root = el?.closest<HTMLElement>("[data-notes-root]");
  if (root?.dataset.notesRoot) {
    return { kind: "root", path: root.dataset.notesRoot };
  }
  const pane = el?.closest<HTMLElement>("[data-pane-leaf]");
  if (pane?.dataset.paneLeaf) {
    return { kind: "pane", leafId: pane.dataset.paneLeaf };
  }
  return null;
}

/** The store action a drop needs; passed in so the decision logic stays pure. */
export interface NoteDropActions {
  moveNote: (path: string, targetDir: string) => Promise<string>;
}

/** Run the right store action for a resolved drop target. */
export function applyNoteDrop(
  target: NoteDropTarget | null,
  notePath: string,
  actions: NoteDropActions,
): void {
  if (!target || target.kind === "pane") {
    return;
  }
  // Swallow a refused move (e.g. a name collision in the target folder); the
  // tree is unchanged in that case, so nothing needs resyncing.
  void actions.moveNote(notePath, target.path).catch(() => {});
}

interface NoteDragState {
  /** The drop target under the cursor, for the sidebar's hover indicator (folder/root only). */
  hover: NoteDropTarget | null;
  setHover: (hover: NoteDropTarget | null) => void;
  /** The pane under the cursor and the pointer's percentage position within it, when dragging over the pane area. Null whenever `hover` (folder/root) is set — they're mutually exclusive. */
  paneHover: { leafId: string; xPct: number; yPct: number } | null;
  /** A resolved pane drop waiting for its owning tab to consume it. */
  pendingPaneDrop: { leafId: string; noteId: string; noteTitle: string; xPct: number; yPct: number } | null;
  clearPendingPaneDrop: () => void;
}

export const useNoteDragStore = create<NoteDragState>((set) => ({
  hover: null,
  setHover: (hover) => set({ hover }),
  paneHover: null,
  pendingPaneDrop: null,
  clearPendingPaneDrop: () => set({ pendingPaneDrop: null }),
}));

const DRAG_THRESHOLD = 5;

// A click fires right after a drag's pointerup; this lets the source row swallow
// that one click so finishing a drag doesn't also open the note.
let suppressClick = false;
export function consumeNoteDragClick(): boolean {
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
  // pointer-events:none is essential — otherwise the ghost would sit under the
  // cursor and elementFromPoint would resolve to it instead of the drop target.
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

// During a drag, force the cursor to a plain pointer everywhere. Without this,
// elements under the cursor keep their own cursor (e.g. the folder name's
// `cursor-text`), so dragging over a folder would flip to the text I-beam.
let cursorStyleEl: HTMLStyleElement | null = null;

function lockCursor(): void {
  const el = document.createElement("style");
  el.textContent = "*{cursor:default !important;}";
  document.head.appendChild(el);
  cursorStyleEl = el;
}

function unlockCursor(): void {
  cursorStyleEl?.remove();
  cursorStyleEl = null;
}

/** Resolve the drop target under a client point via the element beneath it. */
function targetAt(x: number, y: number): NoteDropTarget | null {
  return resolveNoteDrop(document.elementFromPoint(x, y));
}

// Duplicated from dragEntry.ts on purpose — noteDrag.ts and dragEntry.ts
// already duplicate the ghost-label helpers rather than share them across
// these sibling modules.
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

/** True when `el` (or an ancestor) is the tab bar — takes priority over any pane target. */
export function isOverTabBar(el: Element | null): boolean {
  return el?.closest("[data-tab-bar]") != null;
}

/**
 * Begin a pointer drag of a note. Tracks the cursor with pointer events, follows
 * it with a ghost label, highlights the drop target underneath, and on release
 * moves the note into the folder or root it was dropped on.
 */
export function beginNoteDrag(
  notePath: string,
  label: string,
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
    unlockCursor();
    document.body.style.userSelect = "";
  };

  const onMove = (e: PointerEvent) => {
    if (!active) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) {
        return;
      }
      active = true;
      document.body.style.userSelect = "none";
      lockCursor();
      showGhost(label, e.clientX, e.clientY);
    }
    moveGhost(e.clientX, e.clientY);
    const target = targetAt(e.clientX, e.clientY);
    if (target?.kind === "pane") {
      const areaRect = paneAreaRectAt(e.clientX, e.clientY);
      useNoteDragStore.setState({
        hover: null,
        paneHover: areaRect
          ? { leafId: target.leafId, ...pointerToPaneAreaPct(areaRect, e.clientX, e.clientY) }
          : null,
      });
    } else {
      useNoteDragStore.setState({ hover: target, paneHover: null });
    }
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
      useNoteDragStore.setState({ hover: null, paneHover: null });
      useTabsStore.getState().openInNewTab({ kind: "note", noteId: notePath }, label);
      return;
    }
    const target = targetAt(e.clientX, e.clientY);
    if (target?.kind === "pane") {
      const areaRect = paneAreaRectAt(e.clientX, e.clientY);
      const pct = areaRect ? pointerToPaneAreaPct(areaRect, e.clientX, e.clientY) : { xPct: 0, yPct: 0 };
      useNoteDragStore.setState({
        hover: null,
        paneHover: null,
        pendingPaneDrop: { leafId: target.leafId, noteId: notePath, noteTitle: label, ...pct },
      });
      return;
    }
    const { moveNote } = useNotesStore.getState();
    applyNoteDrop(target, notePath, { moveNote });
    useNoteDragStore.setState({ hover: null, paneHover: null });
  };

  const onCancel = () => {
    stop();
    useNoteDragStore.setState({ hover: null, paneHover: null });
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}
