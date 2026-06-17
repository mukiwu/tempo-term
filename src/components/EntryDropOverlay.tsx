import { useEffect, useState } from "react";
import {
  getDraggedEntry,
  setDraggedEntry,
  type DraggedEntry,
} from "@/modules/explorer/lib/dragEntry";

/** True while an explorer entry is being dragged, so panes can show drop zones. */
export function useEntryDragging(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    function onStart() {
      if (getDraggedEntry()) {
        setDragging(true);
      }
    }
    function onEnd() {
      setDragging(false);
    }
    document.addEventListener("dragstart", onStart);
    document.addEventListener("dragend", onEnd);
    document.addEventListener("drop", onEnd);
    return () => {
      document.removeEventListener("dragstart", onStart);
      document.removeEventListener("dragend", onEnd);
      document.removeEventListener("drop", onEnd);
    };
  }, []);
  return dragging;
}

interface EntryDropOverlayProps {
  accept: (entry: DraggedEntry) => boolean;
  onDropEntry: (entry: DraggedEntry) => void;
}

/**
 * A drop target covering its positioned parent. Covering the parent (rather than
 * relying on bubbling) is what lets a drop land on a preview iframe. Green when
 * the dragged entry is accepted, red when not.
 */
export function EntryDropOverlay({ accept, onDropEntry }: EntryDropOverlayProps) {
  const entry = getDraggedEntry();
  const ok = entry ? accept(entry) : false;
  return (
    <div
      className={`absolute inset-0 z-30 border-2 border-dashed ${
        ok ? "border-accent/60 bg-accent/[0.07]" : "border-danger/40 bg-danger/[0.04]"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = ok ? "copy" : "none";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const dropped = getDraggedEntry();
        if (dropped && accept(dropped)) {
          onDropEntry(dropped);
        }
        setDraggedEntry(null);
      }}
    />
  );
}
