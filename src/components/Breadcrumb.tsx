import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, FileText, Folder, FolderOpen, Minus, Plus } from "lucide-react";
import type { LucideProps } from "lucide-react";
import { useOverlayGuard } from "@/lib/overlayGuard";
import type { Crumb } from "@/lib/breadcrumb";

/**
 * What a crumb's menu holds.
 *
 * A terminal uses "tree": the clicked segment heads the menu (click = cd back
 * to it), its subdirectories follow, and every directory row carries a +/-
 * toggle that expands the next level in place — click a name anywhere in the
 * tree to cd there. An editor uses "list": a flat set of items (the files
 * sharing the folder), the current one checked.
 */
export type BreadcrumbMenu =
  | { kind: "tree"; loadChildren: (path: string) => Promise<Crumb[]> }
  | { kind: "list"; loadItems: (crumb: Crumb) => Promise<Crumb[]>; icon?: ComponentType<LucideProps> };

interface BreadcrumbProps {
  crumbs: Crumb[];
  /** Selecting a menu entry switches what this pane shows — never opens a tab. */
  onSelect: (path: string) => void;
  /** Which segments open a menu. An editor only offers its filename segment. */
  clickable?: "all" | "last";
  menu: BreadcrumbMenu;
}

/**
 * The location trail on the left of a pane header (see CONTEXT.md
 * "Breadcrumb"). Aligned to the trail's end so a narrow pane clips the head,
 * keeping the segments closest to the cwd/file visible.
 */
export function Breadcrumb({ crumbs, onSelect, clickable = "all", menu }: BreadcrumbProps) {
  const [openFor, setOpenFor] = useState<{ crumb: Crumb; x: number; y: number } | null>(null);

  function openMenu(e: MouseEvent<HTMLButtonElement>, crumb: Crumb) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setOpenFor({ crumb, x: rect.left, y: rect.bottom + 2 });
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
                onClick={(e) => openMenu(e, crumb)}
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
      {openFor && (
        <BreadcrumbPopover
          crumb={openFor.crumb}
          x={openFor.x}
          y={openFor.y}
          menu={menu}
          onSelect={onSelect}
          onClose={() => setOpenFor(null)}
        />
      )}
    </div>
  );
}

/** One directory in the expanded tree; children stay null until first expand. */
interface TreeNode {
  crumb: Crumb;
  expanded: boolean;
  children: TreeNode[] | null;
}

function toNode(crumb: Crumb): TreeNode {
  return { crumb, expanded: false, children: null };
}

/** Replace the node holding `path` (paths are unique — they are the tree). */
function updateNode(node: TreeNode, path: string, fn: (n: TreeNode) => TreeNode): TreeNode {
  if (node.crumb.path === path) {
    return fn(node);
  }
  if (!node.children) {
    return node;
  }
  return { ...node, children: node.children.map((child) => updateNode(child, path, fn)) };
}

/**
 * The crumb's dropdown. Shares ContextMenu's shell behaviors (portal, on-screen
 * clamp, outside-click/Escape/outside-scroll close, scrollable body) but renders
 * either the expandable directory tree or the editor's flat file list — shapes
 * ContextMenu's flat item array can't hold.
 */
function BreadcrumbPopover({
  crumb,
  x,
  y,
  menu,
  onSelect,
  onClose,
}: {
  crumb: Crumb;
  x: number;
  y: number;
  menu: BreadcrumbMenu;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [items, setItems] = useState<Crumb[] | null>(null);

  useOverlayGuard(true);

  // Load the first level (tree) or the flat items (list) as the menu opens.
  useEffect(() => {
    let cancelled = false;
    if (menu.kind === "tree") {
      menu
        .loadChildren(crumb.path)
        .catch(() => [] as Crumb[])
        .then((children) => {
          if (!cancelled) {
            setRoot({ crumb, expanded: true, children: children.map(toNode) });
          }
        });
    } else {
      menu
        .loadItems(crumb)
        .then((loaded) => {
          if (!cancelled) {
            if (loaded.length === 0) {
              onClose();
            } else {
              setItems(loaded);
            }
          }
        })
        .catch(() => {
          if (!cancelled) {
            onClose();
          }
        });
    }
    return () => {
      cancelled = true;
    };
    // The popover remounts per open (keyed by openFor state), so load once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the menu on-screen once it has content to measure.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) {
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - width - pad);
    }
    if (top + height > window.innerHeight - pad) {
      top = y - height >= pad ? y - height : Math.max(pad, window.innerHeight - height - pad);
    }
    setPos({ left, top });
  }, [x, y, root !== null, items !== null]);

  useEffect(() => {
    function onPointerDown(event: globalThis.MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    // A scroll anywhere else drifts the menu off its anchor, so close — but the
    // menu's own body scrolls when the tree outgrows it.
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

  function toggle(node: TreeNode) {
    if (menu.kind !== "tree") {
      return;
    }
    const path = node.crumb.path;
    if (node.expanded) {
      setRoot((r) => r && updateNode(r, path, (n) => ({ ...n, expanded: false })));
      return;
    }
    if (node.children) {
      setRoot((r) => r && updateNode(r, path, (n) => ({ ...n, expanded: true })));
      return;
    }
    menu
      .loadChildren(path)
      .catch(() => [] as Crumb[])
      .then((children) => {
        setRoot(
          (r) =>
            r &&
            updateNode(r, path, (n) => ({ ...n, expanded: true, children: children.map(toNode) })),
        );
      });
  }

  function pick(path: string) {
    onClose();
    onSelect(path);
  }

  /**
   * One directory and, when expanded, its children nested inside a guided
   * block. The indent unit equals the 16px icon column, so each level's
   * toggle sits exactly under its parent's name — and the vertical guide
   * hanging from the parent's icon column says "everything right of this
   * line is inside me".
   */
  function treeRow(node: TreeNode, isHead: boolean): ReactNode {
    return (
      <div key={node.crumb.path}>
        <div className="flex items-center">
          {isHead ? (
            // The current location heads the menu; picking it cds back here.
            <span className="grid h-5 w-4 shrink-0 place-items-center text-accent">
              <Check size={13} />
            </span>
          ) : (
            <button
              type="button"
              aria-label={t(node.expanded ? "breadcrumb.collapse" : "breadcrumb.expand", {
                name: node.crumb.label,
              })}
              onClick={() => toggle(node)}
              className="grid h-5 w-4 shrink-0 place-items-center rounded-sm text-fg-subtle hover:bg-bg hover:text-fg"
            >
              {node.expanded ? <Minus size={12} /> : <Plus size={12} />}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => pick(node.crumb.path)}
            className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left transition-colors hover:bg-bg hover:text-fg ${
              isHead ? "text-fg" : "text-fg-muted"
            }`}
          >
            {isHead || node.expanded ? (
              <FolderOpen size={14} className="shrink-0 text-fg-subtle" />
            ) : (
              <Folder size={14} className="shrink-0 text-fg-subtle" />
            )}
            <span className="truncate">{node.crumb.label}</span>
          </button>
        </div>
        {node.expanded && node.children && node.children.length > 0 && (
          <div className="ml-[7px] border-l border-border pl-2">
            {node.children.map((child) => treeRow(child, false))}
          </div>
        )}
      </div>
    );
  }

  const listIcon = menu.kind === "list" ? (menu.icon ?? FileText) : FileText;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      className="z-[200] max-h-[60vh] min-w-[220px] overflow-y-auto rounded-md border border-border-strong bg-bg-elevated px-1 py-1 text-[13px] shadow-lg"
    >
      {menu.kind === "tree" && root && treeRow(root, true)}
      {menu.kind === "list" &&
        items?.map((item) => {
          const isCurrent = item.path === crumb.path;
          const Icon = isCurrent ? Check : listIcon;
          return (
            <button
              key={item.path}
              type="button"
              role="menuitem"
              onClick={() => pick(item.path)}
              className={`flex w-full items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left transition-colors hover:bg-bg hover:text-fg ${
                isCurrent ? "text-fg" : "text-fg-muted"
              }`}
            >
              <Icon size={14} className={`shrink-0 ${isCurrent ? "text-accent" : "text-fg-subtle"}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
    </div>,
    document.body,
  );
}
