import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import type { LucideProps } from "lucide-react";
import { useOverlayGuard } from "@/lib/overlayGuard";

export interface ContextMenuItem {
  /** Stable key, also used to group items: a divider is drawn between groups. */
  id: string;
  label: string;
  icon: ComponentType<LucideProps>;
  onSelect: () => void;
  /** Render in the danger colour (used for destructive actions like Delete). */
  danger?: boolean;
  /** Greyed and non-clickable (e.g. Copy with nothing selected). */
  disabled?: boolean;
  /** Group index; a thin divider separates consecutive groups. */
  group?: number;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * A fixed-positioned menu rendered through a portal to `document.body` so it is
 * never clipped by the sidebar's `overflow-hidden`. Closes on outside-click,
 * Escape, scroll, or window resize. Items are grouped (by `group`) with thin
 * dividers between groups.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Rendered only while open, so guard unconditionally to hide the preview webview.
  useOverlayGuard(true);

  // Keep the menu on-screen: a right-click near the right/bottom edge (e.g. the
  // AI input at the foot of the panel) would otherwise open past the viewport
  // and get clipped. Measured before paint, so the corrected position is the
  // first one shown — no visible jump. Flip to the other side of the cursor when
  // there's room there, otherwise clamp against the edge.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) {
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + width > vw - pad) {
      left = x - width >= pad ? x - width : Math.max(pad, vw - width - pad);
    }
    if (top + height > vh - pad) {
      top = y - height >= pad ? y - height : Math.max(pad, vh - height - pad);
    }
    setPos({ left, top });
  }, [x, y, items.length]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    // Scroll/resize would leave the menu floating away from its anchor, so just
    // close it. Capture phase catches scrolls on inner containers too — except
    // the menu's own list, which scrolls when it holds more items than fit.
    function onScroll(event: Event) {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) {
        return;
      }
      onClose();
    }
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      // Portal events still bubble through the REACT tree, so without this a
      // menu-item click would also fire the owning row's onClick (e.g. a
      // source-control row opening its diff tab on "Copy Path").
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="z-[200] max-h-[60vh] min-w-[200px] overflow-y-auto rounded-md border border-border-strong bg-bg-elevated py-1 text-[13px] shadow-lg"
    >
      {items.map((item, index) => {
        const previous = items[index - 1];
        const newGroup =
          previous !== undefined && (previous.group ?? 0) !== (item.group ?? 0);
        const Icon = item.icon;
        return (
          <div key={item.id}>
            {newGroup && <div className="my-1 h-px bg-border" />}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                item.disabled
                  ? "cursor-default text-fg-muted/40"
                  : item.danger
                    ? "text-danger hover:bg-danger/10"
                    : "text-fg-muted hover:bg-bg hover:text-fg"
              }`}
            >
              <Icon size={14} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
