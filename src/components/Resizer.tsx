interface ResizerProps {
  orientation: "horizontal" | "vertical";
  onResize: (deltaPx: number) => void;
  onResizeEnd?: () => void;
}

/**
 * A drag handle for resizing panes. "vertical" sits between left/right panes
 * (drag changes width); "horizontal" sits between top/bottom panes (drag
 * changes height). Ported from the gitlanes Resizer.
 */
export function Resizer({ orientation, onResize, onResizeEnd }: ResizerProps) {
  const isHorizontal = orientation === "horizontal";

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let last = isHorizontal ? e.clientY : e.clientX;
    const cursorClass = isHorizontal ? "cursor-row-resize" : "cursor-col-resize";
    document.body.classList.add(cursorClass, "select-none");

    const move = (ev: PointerEvent) => {
      const current = isHorizontal ? ev.clientY : ev.clientX;
      const delta = current - last;
      last = current;
      if (delta !== 0) onResize(delta);
    };
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      document.body.classList.remove(cursorClass, "select-none");
      onResizeEnd?.();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  return (
    <div
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={isHorizontal ? "horizontal" : "vertical"}
      className={`shrink-0 bg-border transition-colors hover:bg-accent active:bg-accent ${
        isHorizontal ? "h-1 w-full cursor-row-resize" : "h-full w-1 cursor-col-resize"
      }`}
    />
  );
}
