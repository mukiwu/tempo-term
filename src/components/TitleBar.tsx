import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, Ellipsis, Minus, Square, X } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useOverlayGuard } from "@/lib/overlayGuard";
import { IS_WINDOWS } from "@/lib/platform";
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  toggleMaximizeWindow,
} from "@/lib/window";
import {
  buildMenus,
  computeVisibleCount,
  executeMenuAction,
  getMenuContext,
  type MenuContext,
  type MenuItemDef,
} from "@/components/menuBarMenus";

/** Width-relevant classes for a top-level menu-bar button. Shared by the real
 *  buttons, the […] overflow button, and the hidden measurement row so all three
 *  size identically and the fit math stays honest. State (open/hover) colors are
 *  appended per-button and don't affect width. */
const MENU_BUTTON_CLASS =
  "flex h-full shrink-0 items-center whitespace-nowrap px-2 text-[13px] transition-colors min-[820px]:px-3";

/** Sentinel `openId` for the […] overflow dropdown (vs a real menu's id). */
const OVERFLOW_ID = "__overflow__";

/** Overlapping-squares "restore" glyph; lucide has no direct equivalent. */
function RestoreIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      <path d="M3 3H9V9H3V3Z" />
      <path d="M5 1.5H11V7.5H9" />
    </svg>
  );
}

/**
 * One item row inside a dropdown (either a top-level menu's item, or a child of
 * a submenu). Shared so the submenu flyout renders identically to its parent.
 */
function MenuItemRow({
  item,
  disabled,
  shortcutHint,
  isSubmenuOpen,
  onSelect,
  onSubmenuEnter,
  onSiblingEnter,
}: {
  item: MenuItemDef;
  disabled: boolean;
  shortcutHint: string | undefined;
  isSubmenuOpen: boolean;
  onSelect: () => void;
  onSubmenuEnter?: (rect: DOMRect) => void;
  onSiblingEnter?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={disabled || undefined}
      aria-haspopup={item.submenu ? "menu" : undefined}
      aria-expanded={item.submenu ? isSubmenuOpen : undefined}
      // A menu item click must not steal focus/selection from whatever the
      // user had focused before opening the menu (a terminal, an editor, a
      // text input) — Edit > Copy/Paste/Select All rely on that selection
      // still being live for the document.execCommand fallback in
      // editActions.ts. Mousedown is what normally moves focus, so block it
      // here; onClick (focus-independent) still fires the action.
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={(e) => {
        // JS mouse events, not CSS :hover — the native preview webview floats
        // above all DOM in this app, so a WKWebView pop-up flyout must be driven
        // by JS state, or hover never registers over it (project WKWebView quirk).
        if (item.submenu) {
          onSubmenuEnter?.(e.currentTarget.getBoundingClientRect());
        } else {
          onSiblingEnter?.();
        }
      }}
      onClick={onSelect}
      className={`flex w-full items-center gap-6 px-3 py-1.5 text-left transition-colors ${
        disabled
          ? "text-fg-subtle cursor-default"
          : "text-fg-muted hover:bg-bg hover:text-fg"
      }`}
    >
      <span className="truncate">{t(item.labelKey)}</span>
      {item.submenu ? (
        <ChevronRight size={14} className="ml-auto shrink-0 text-fg-subtle" />
      ) : (
        shortcutHint && (
          <span className="ml-auto text-[11px] text-fg-subtle">{shortcutHint}</span>
        )
      )}
    </button>
  );
}

/**
 * In-window text menu bar (File / Edit / View / Terminal / Window / Help) for Windows.
 * On Windows the native frame is hidden (`decorations(false)`), so this self-drawn menu
 * bar renders to replace it. On macOS, the native menu bar handles these menus, so this
 * component does not render.
 *
 * Menu structure and disabled/action logic live in `menuBarMenus.ts`
 * (data-driven: `buildMenus` + `getMenuContext`). Each item either runs a direct
 * window/new-window action or fires the same scoped `menu:*` event the macOS
 * native menu emits, so App.tsx's existing listeners stay the single source of
 * truth for what each action does.
 */
// How long a sibling-row hover holds off closing the open submenu, so diagonal
// mouse travel from the submenu row toward its flyout (which necessarily
// crosses sibling rows first) has time to land before the flyout disappears.
const SUBMENU_CLOSE_DELAY_MS = 180;

// A submenu narrower than this is assumed to fit; used only to decide which side
// to open on, so a slight over-estimate just biases toward flipping left.
const ESTIMATED_SUBMENU_WIDTH = 240;

/**
 * A dropdown panel of menu rows that recursively renders any item's `submenu` as
 * a nested flyout — the cascade behind the […] overflow (and View → Sidebar
 * Panel). Each submenu opens to the right when it fits, otherwise flips left, so
 * it never runs off the viewport edge. Every level owns its hover-close timer:
 * crossing sibling rows toward a flyout schedules a close; entering the child
 * flyout cancels the parent's.
 */
function MenuFlyout({
  items,
  ctx,
  style,
  onAction,
  onMouseEnter,
  rootRef,
  minWidthClass = "min-w-[200px]",
}: {
  items: MenuItemDef[];
  ctx: MenuContext;
  style: CSSProperties;
  onAction: (item: MenuItemDef) => void;
  onMouseEnter?: () => void;
  rootRef?: Ref<HTMLDivElement>;
  minWidthClass?: string;
}) {
  const [openSubId, setOpenSubId] = useState<string | null>(null);
  const [sub, setSub] = useState<{
    side: "left" | "right";
    left: number;
    right: number;
    y: number;
  } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    clearClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpenSubId(null);
    }, SUBMENU_CLOSE_DELAY_MS);
  };
  useEffect(() => clearClose, []);

  const shortcutHint = (s?: { mac: string; win: string }) =>
    s ? (IS_WINDOWS ? s.win : s.mac) : undefined;

  return (
    <div
      ref={rootRef}
      role="menu"
      onMouseEnter={onMouseEnter}
      style={style}
      className={`z-[200] ${minWidthClass} overflow-hidden rounded-md border border-border-strong bg-bg-elevated py-1 text-[13px] shadow-lg`}
    >
      {items.map((item, index) => {
        const previous = items[index - 1];
        const newGroup = previous !== undefined && previous.group !== item.group;
        const disabled = item.disabled?.(ctx) ?? false;
        const isSubmenuOpen = openSubId === item.id;
        return (
          <div key={item.id} className="relative">
            {newGroup && <div className="my-1 h-px bg-border" />}
            <MenuItemRow
              item={item}
              disabled={disabled}
              shortcutHint={shortcutHint(item.shortcut)}
              isSubmenuOpen={isSubmenuOpen}
              // Submenu parents open on hover (below); a click on them is a no-op.
              onSelect={() => {
                if (!disabled && !item.submenu) onAction(item);
              }}
              onSubmenuEnter={(rect) => {
                clearClose();
                // Open to the right of the row when it fits; otherwise flip left
                // so the flyout never runs off the viewport's right edge.
                const opensRight =
                  window.innerWidth - rect.right >= ESTIMATED_SUBMENU_WIDTH;
                setSub({
                  side: opensRight ? "right" : "left",
                  left: rect.right,
                  right: window.innerWidth - rect.left,
                  y: rect.top,
                });
                setOpenSubId(item.id);
              }}
              onSiblingEnter={scheduleClose}
            />
            {item.submenu && isSubmenuOpen && sub && (
              <MenuFlyout
                items={item.submenu}
                ctx={ctx}
                onAction={onAction}
                onMouseEnter={clearClose}
                style={
                  sub.side === "right"
                    ? { position: "fixed", left: sub.left, top: sub.y }
                    : { position: "fixed", right: sub.right, top: sub.y }
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function WindowMenuBar() {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  // Anchor for the open dropdown, pinned to the button's bottom-left. Every menu
  // (including […]) sits after the brand with the drag region and window controls
  // to its right, so it always has room to open rightward from its left edge.
  const [anchor, setAnchor] = useState<{ left: number; y: number } | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  // How many leading menus fit; the rest collapse into the […] button. Starts
  // "all" so the first paint is complete, then the measurement effect clamps it.
  const [visibleCount, setVisibleCount] = useState(Number.MAX_SAFE_INTEGER);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  // The native preview webview floats above all DOM, so hide it while a menu is
  // open or it would cover the dropdown (same guard ContextMenu uses).
  useOverlayGuard(openId !== null);

  // Tracked independently of the Windows control buttons' own isMaximized state
  // (TitleBar's, below) so this component works standalone once it's also
  // rendered on macOS, which has no equivalent control-button state to share.
  useEffect(() => {
    const sync = () => {
      void isWindowMaximized()
        .then(setIsMaximized)
        .catch(() => {});
    };
    sync();
    const unlisten = onWindowResized(sync);
    return () => {
      void unlisten.then((off) => off()).catch(() => {});
    };
  }, []);

  const ctx = getMenuContext(isMaximized);
  const menus = buildMenus(ctx);

  // Fit the menu buttons to the space between the brand and the window controls,
  // collapsing whatever doesn't fit into the […] button. Widths are measured
  // from a hidden row that mirrors the real buttons, so the math tracks the live
  // font/zoom/locale metrics instead of hard-coded sizes. Re-runs whenever the
  // bar's width (window resize, zoom) or the measured row (locale) changes.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const measure = measureRef.current;
    if (!bar || !measure) return;
    const recompute = () => {
      const items = Array.from(measure.children) as HTMLElement[];
      // The measurement row is [one span per menu…, the […] button].
      const widths = items.slice(0, menus.length).map((el) => el.getBoundingClientRect().width);
      const moreWidth = items[menus.length]?.getBoundingClientRect().width ?? 0;
      setVisibleCount(computeVisibleCount(widths, moreWidth, bar.clientWidth));
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(bar);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [menus.length]);

  const onItemSelect = (item: MenuItemDef) => {
    if (item.disabled?.(ctx) || !item.action) return;
    executeMenuAction(item.action);
    setOpenId(null);
  };

  // Close on outside pointer / Escape / resize. The menu-bar buttons count as
  // "inside", so clicking the open button falls through to its own onClick
  // (which toggles it shut) instead of this handler racing to reopen it.
  useEffect(() => {
    if (openId === null) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (barRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpenId(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenId(null);
      }
    }
    function onResize() {
      setOpenId(null);
    }
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize, true);
    };
  }, [openId]);

  function openFrom(el: HTMLElement, id: string) {
    const rect = el.getBoundingClientRect();
    setAnchor({ left: rect.left, y: rect.bottom });
    setOpenId(id);
  }

  // Fixed-position style pinning a dropdown to the button's bottom-left.
  const anchorStyle = (): CSSProperties => ({
    position: "fixed",
    left: anchor?.left,
    top: anchor?.y,
  });

  const activeMenu = menus.find((m) => m.id === openId) ?? null;
  const visibleMenus = menus.slice(0, visibleCount);
  const overflowMenus = menus.slice(visibleCount);
  // The […] dropdown is just a cascade: each collapsed menu becomes a submenu
  // parent, so hovering it flies its items out to the side instead of replacing
  // the list. Reuses the same MenuFlyout recursion as the normal dropdowns.
  const overflowItems: MenuItemDef[] = overflowMenus.map((menu) => ({
    id: menu.id,
    labelKey: menu.labelKey,
    group: 0,
    submenu: menu.items,
  }));

  return (
    // flex-1 + min-w-0: the bar takes the space between the brand and the window
    // controls and may shrink below its content; overflow-hidden hides the
    // measurement row and clips any transient overflow during a resize.
    <div ref={barRef} className="relative flex h-full min-w-0 flex-1 items-center overflow-hidden">
      {/* Hidden measurement row: every menu label plus the […] button, laid out
          exactly like the real ones (same MENU_BUTTON_CLASS) but not painted, so
          getBoundingClientRect gives their natural widths regardless of how many
          are currently shown — and re-measures on zoom/locale via ResizeObserver. */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex h-full items-center"
      >
        {menus.map((menu) => (
          <span key={menu.id} className={MENU_BUTTON_CLASS}>
            {t(menu.labelKey)}
          </span>
        ))}
        <span className={MENU_BUTTON_CLASS}>
          <Ellipsis size={16} />
        </span>
      </div>
      {visibleMenus.map((menu) => (
        <button
          key={menu.id}
          type="button"
          aria-haspopup="menu"
          aria-expanded={openId === menu.id}
          // Same rationale as MenuItemRow above: opening a top-level menu
          // must not itself steal focus from whatever pane/input the user was
          // in — only selecting an item runs an action.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            if (openId === menu.id) {
              setOpenId(null);
            } else {
              openFrom(e.currentTarget, menu.id);
            }
          }}
          // Once a menu is open, hovering a sibling switches to it — standard
          // menu-bar behaviour.
          onMouseEnter={(e) => {
            if (openId !== null && openId !== menu.id) openFrom(e.currentTarget, menu.id);
          }}
          className={`${MENU_BUTTON_CLASS} ${
            openId === menu.id
              ? "bg-bg-elevated text-fg"
              : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
          }`}
        >
          {t(menu.labelKey)}
        </button>
      ))}
      {overflowMenus.length > 0 && (
        <button
          ref={moreButtonRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={openId === OVERFLOW_ID}
          aria-label={t("titleBar.moreMenus")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            if (openId === OVERFLOW_ID) {
              setOpenId(null);
            } else {
              openFrom(e.currentTarget, OVERFLOW_ID);
            }
          }}
          onMouseEnter={(e) => {
            if (openId !== null && openId !== OVERFLOW_ID)
              openFrom(e.currentTarget, OVERFLOW_ID);
          }}
          className={`${MENU_BUTTON_CLASS} ${
            openId === OVERFLOW_ID
              ? "bg-bg-elevated text-fg"
              : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
          }`}
        >
          <Ellipsis size={16} />
        </button>
      )}
      {/* The leftover width stays a drag region so the window is still movable
          from the empty stretch of the title bar. */}
      <div data-tauri-drag-region="deep" className="h-full flex-1" />
      {openId === OVERFLOW_ID &&
        anchor &&
        createPortal(
          <MenuFlyout
            rootRef={menuRef}
            items={overflowItems}
            ctx={ctx}
            style={anchorStyle()}
            onAction={onItemSelect}
            // The list holds only menu names — keep it narrow so it sits snug
            // under the […] button.
            minWidthClass="min-w-[9rem]"
          />,
          document.body,
        )}
      {activeMenu &&
        anchor &&
        createPortal(
          <MenuFlyout
            rootRef={menuRef}
            items={activeMenu.items}
            ctx={ctx}
            style={anchorStyle()}
            onAction={onItemSelect}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * Custom title bar, Windows only. The native frame is hidden
 * (`decorations(false)`): a self-drawn text menu bar sits on the left, a
 * draggable region fills the middle, and the minimize / maximize-restore / close
 * controls sit on the right — each control group is kept non-draggable so clicks
 * aren't swallowed by the drag region. The controls render through a portal
 * to document.body so no dialog can cover them. On macOS this renders nothing: the
 * native menu bar owns the menus (menu.rs) and TabBar is the window's first
 * row, reserving the traffic-light overlay space with its own left padding.
 */
export function TitleBar() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  // Track the maximized state so the middle button shows the right icon/label.
  // Hooks run unconditionally; the effect no-ops off Windows.
  useEffect(() => {
    if (!IS_WINDOWS) {
      return;
    }
    const sync = () => {
      void isWindowMaximized()
        .then(setIsMaximized)
        .catch(() => {});
    };
    sync();
    const unlisten = onWindowResized(sync);
    return () => {
      void unlisten.then((off) => off()).catch(() => {});
    };
  }, []);

  if (!IS_WINDOWS) {
    return null;
  }

  return (
    <>
      <div className="flex h-8 shrink-0 items-center border-b border-border bg-bg-inset">
        {/* Brand mark, and the window's drag handle. "deep" (not a bare
            data-tauri-drag-region) makes clicks anywhere in the subtree drag the
            window — a bare attribute is "self mode" and only drags on direct hits
            of this div, so grabbing the icon or the title text (both children)
            would do nothing. shrink-0 keeps it from being squeezed by the menu. */}
        <div
          data-tauri-drag-region="deep"
          className="flex h-full shrink-0 select-none items-center gap-1.5 pl-2.5 pr-1"
        >
          <img src="/icon.png" alt="" className="h-4 w-4 rounded-sm" draggable={false} />
          <span className="whitespace-nowrap text-[13px] font-semibold text-fg">
            {t("appName")}
          </span>
        </div>
        <WindowMenuBar />
        {/* Layout stand-in for the window controls, which render through the
            portal below: it keeps the menu bar's overflow math and the drag slack
            exactly as wide as if the three w-11 buttons sat here. */}
        <div aria-hidden className="h-full w-[132px] shrink-0" />
      </div>
      {/* The controls live outside the app tree on purpose. A z-index only
          competes inside its own stacking context, and App's root is `isolate`
          (it needs to be, for the wallpaper's -z-10). CommitInputModal and the
          tab-close ConfirmDialog portal their `fixed inset-0` backdrops to
          document.body — outside that context — so a raised z-index inside the
          tree can never climb above them. Portalled to body and pinned to the
          top-right, at z-300, the controls out-rank every backdrop wherever it is
          mounted, so minimize / maximize / close stay clickable while a dialog is
          open — the native controls they replace always are. Only the controls
          are lifted: the menu bar stays under the backdrop, or a dialog could be
          dismissed-by-menu from behind its own overlay. */}
      {createPortal(
        <div className="fixed right-0 top-0 z-[300] flex h-8 items-center">
          <Tooltip label={t("titleBar.minimize")} side="bottom">
            <button
              type="button"
              aria-label={t("titleBar.minimize")}
              onClick={() => void minimizeWindow()}
              className="flex h-8 w-11 items-center justify-center text-fg-subtle transition-colors hover:bg-bg-elevated hover:text-fg"
            >
              <Minus size={15} />
            </button>
          </Tooltip>
          <Tooltip label={isMaximized ? t("titleBar.restore") : t("titleBar.maximize")} side="bottom">
            <button
              type="button"
              aria-label={isMaximized ? t("titleBar.restore") : t("titleBar.maximize")}
              onClick={() => void toggleMaximizeWindow()}
              className="flex h-8 w-11 items-center justify-center text-fg-subtle transition-colors hover:bg-bg-elevated hover:text-fg"
            >
              {isMaximized ? <RestoreIcon size={11} /> : <Square size={12} />}
            </button>
          </Tooltip>
          <Tooltip label={t("titleBar.close")} side="bottom">
            <button
              type="button"
              aria-label={t("titleBar.close")}
              onClick={() => void closeWindow()}
              className="flex h-8 w-11 items-center justify-center text-fg-subtle transition-colors hover:bg-danger hover:text-white"
            >
              <X size={16} />
            </button>
          </Tooltip>
        </div>,
        document.body,
      )}
    </>
  );
}
