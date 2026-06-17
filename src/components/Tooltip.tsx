import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  label: string;
  side?: "bottom" | "top" | "right";
  children: ReactNode;
}

/**
 * A hover tooltip rendered through a portal with fixed positioning. WebKit (the
 * macOS WebView) often won't show native `title` tooltips, and a CSS one would
 * be clipped by the sidebar's overflow — a portal sidesteps both.
 */
export function Tooltip({ label, side = "bottom", children }: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  function show() {
    const el = anchorRef.current;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    if (side === "right") {
      setCoords({ x: r.right + 8, y: r.top + r.height / 2 });
    } else if (side === "top") {
      setCoords({ x: r.left + r.width / 2, y: r.top - 8 });
    } else {
      setCoords({ x: r.left + r.width / 2, y: r.bottom + 8 });
    }
  }

  const transform =
    side === "right"
      ? "translateY(-50%)"
      : side === "top"
        ? "translate(-50%, -100%)"
        : "translateX(-50%)";

  return (
    <span
      ref={anchorRef}
      onMouseEnter={show}
      onMouseLeave={() => setCoords(null)}
      className="inline-flex"
    >
      {children}
      {coords &&
        createPortal(
          <span
            role="tooltip"
            style={{ position: "fixed", left: coords.x, top: coords.y, transform }}
            className="pointer-events-none z-[100] whitespace-nowrap rounded-md border border-border-strong bg-bg-elevated px-2 py-1 text-xs text-fg shadow-lg"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
