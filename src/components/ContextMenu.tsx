import { useEffect, useRef, type ComponentType } from "react";
import { createPortal } from "react-dom";
import type { LucideProps } from "lucide-react";

export interface ContextMenuItem {
  /** Stable key, also used to group items: a divider is drawn between groups. */
  id: string;
  label: string;
  icon: ComponentType<LucideProps>;
  onSelect: () => void;
  /** Render in the danger colour (used for destructive actions like Delete). */
  danger?: boolean;
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
    // close it. Capture phase catches scrolls on inner containers too.
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", left: x, top: y }}
      className="z-[200] min-w-[200px] overflow-hidden rounded-md border border-border-strong bg-bg-elevated py-1 text-[13px] shadow-lg"
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
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                item.danger
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
