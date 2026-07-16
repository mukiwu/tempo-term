import { useState, type ComponentType, type MouseEvent } from "react";
import { Check, Folder } from "lucide-react";
import type { LucideProps } from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import type { Crumb } from "@/lib/breadcrumb";

interface BreadcrumbProps {
  crumbs: Crumb[];
  /**
   * The clicked segment's siblings (the current one included, it gets the
   * check mark). A terminal lists sibling directories, an editor lists the
   * files sharing the folder — the caller decides what "sibling" means.
   */
  loadSiblings: (crumb: Crumb) => Promise<Crumb[]>;
  /** Selecting a sibling switches what this pane shows — never opens a tab. */
  onSelect: (path: string) => void;
  /** Which segments open a menu. An editor only offers its filename segment. */
  clickable?: "all" | "last";
  /** Menu-item icon for non-current siblings: folders by default, files for an editor. */
  siblingIcon?: ComponentType<LucideProps>;
}

/**
 * The location trail on the left of a pane header (see CONTEXT.md
 * "Breadcrumb"). Aligned to the trail's end so a narrow pane clips the head,
 * keeping the segments closest to the cwd/file visible.
 */
export function Breadcrumb({
  crumbs,
  loadSiblings,
  onSelect,
  clickable = "all",
  siblingIcon = Folder,
}: BreadcrumbProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(
    null,
  );

  async function openMenu(e: MouseEvent<HTMLButtonElement>, crumb: Crumb) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    let siblings: Crumb[];
    try {
      siblings = await loadSiblings(crumb);
    } catch {
      return; // an unreadable directory just doesn't open a menu
    }
    if (siblings.length === 0) {
      return;
    }
    setMenu({
      x: rect.left,
      y: rect.bottom + 2,
      items: siblings.map((sibling) => ({
        id: sibling.path,
        label: sibling.label,
        icon: sibling.path === crumb.path ? Check : siblingIcon,
        onSelect: () => onSelect(sibling.path),
      })),
    });
  }

  return (
    <div className="flex min-w-0 items-center justify-end overflow-hidden text-[13px] text-fg-muted">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        const isClickable = clickable === "all" || isLast;
        return (
          <span key={crumb.path} className="flex shrink-0 items-center">
            {index > 0 && <span className="px-0.5 text-fg-subtle">›</span>}
            {isClickable ? (
              <button
                type="button"
                onClick={(e) => void openMenu(e, crumb)}
                className="rounded px-0.5 transition-colors hover:bg-bg-elevated hover:text-fg"
              >
                {crumb.label}
              </button>
            ) : (
              <span className="px-0.5">{crumb.label}</span>
            )}
          </span>
        );
      })}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
