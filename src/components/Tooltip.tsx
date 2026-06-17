import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  label: string;
  side?: "bottom" | "top" | "right";
  children: ReactNode;
}

const MARGIN = 6;

/**
 * A hover tooltip rendered through a portal with fixed positioning, clamped to
 * stay within the viewport. WebKit (the macOS WebView) often won't show native
 * `title` tooltips, and a CSS one would be clipped by the sidebar's overflow —
 * a portal plus clamping sidesteps both.
 */
export function Tooltip({ label, side = "bottom", children }: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure the rendered tooltip, then place it and clamp to the viewport.
  useLayoutEffect(() => {
    if (!anchor || !tipRef.current) {
      return;
    }
    const tip = tipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if (side === "right") {
      left = anchor.right + 8;
      top = anchor.top + anchor.height / 2 - tip.height / 2;
    } else if (side === "top") {
      left = anchor.left + anchor.width / 2 - tip.width / 2;
      top = anchor.top - tip.height - 8;
    } else {
      left = anchor.left + anchor.width / 2 - tip.width / 2;
      top = anchor.bottom + 8;
    }
    left = Math.max(MARGIN, Math.min(left, vw - tip.width - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - tip.height - MARGIN));
    setPos({ left, top });
  }, [anchor, side]);

  return (
    <span
      ref={anchorRef}
      onMouseEnter={() => setAnchor(anchorRef.current?.getBoundingClientRect() ?? null)}
      onMouseLeave={() => {
        setAnchor(null);
        setPos(null);
      }}
      className="inline-flex"
    >
      {children}
      {anchor &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            style={{
              position: "fixed",
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              // Hidden until measured so the unclamped first frame never flashes.
              visibility: pos ? "visible" : "hidden",
            }}
            className="pointer-events-none z-[100] whitespace-nowrap rounded-md border border-border-strong bg-bg-elevated px-2 py-1 text-xs text-fg shadow-lg"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
