import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, Minus, Square, X } from "lucide-react";
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
  executeMenuAction,
  getMenuContext,
  type MenuItemDef,
} from "@/components/menuBarMenus";

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
 * Text menu bar (File / Edit / View / Terminal / Window / Help) for the custom
 * title bar. The native menu bar is gone because the frame is hidden
 * (`decorations(false)`) — and even if shown it is OS-drawn and can't follow the
 * app's theme. This self-drawn menu uses the same CSS tokens as the rest of the
 * UI, so it recolours with the theme.
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

function WindowMenuBar() {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [submenuId, setSubmenuId] = useState<string | null>(null);
  const [submenuAnchor, setSubmenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearSubmenuCloseTimer() {
    if (submenuCloseTimer.current !== null) {
      clearTimeout(submenuCloseTimer.current);
      submenuCloseTimer.current = null;
    }
  }

  // Close immediately: used for every close that isn't the sibling-hover
  // tunneling case below (item selected, menu dismissed, menu switched).
  function closeSubmenuNow() {
    clearSubmenuCloseTimer();
    setSubmenuId(null);
  }

  // Hovering a sibling row schedules the close instead of firing it
  // immediately, so the cursor has SUBMENU_CLOSE_DELAY_MS to reach the
  // flyout (entering the submenu's own row again, or the flyout itself,
  // cancels the pending close — see the handlers below).
  function scheduleSubmenuClose() {
    clearSubmenuCloseTimer();
    submenuCloseTimer.current = setTimeout(() => {
      submenuCloseTimer.current = null;
      setSubmenuId(null);
    }, SUBMENU_CLOSE_DELAY_MS);
  }

  // Timer must not outlive the component, and must not fire against a menu
  // that's already been torn down and remounted.
  useEffect(() => clearSubmenuCloseTimer, []);

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

  const shortcutHint = (s?: { mac: string; win: string }) =>
    s ? (IS_WINDOWS ? s.win : s.mac) : undefined;

  const onItemSelect = (item: MenuItemDef) => {
    if (item.disabled?.(ctx) || !item.action) return;
    executeMenuAction(item.action);
    setOpenId(null);
    closeSubmenuNow();
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
      closeSubmenuNow();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenId(null);
        closeSubmenuNow();
      }
    }
    function onResize() {
      setOpenId(null);
      closeSubmenuNow();
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
    setAnchor({ x: rect.left, y: rect.bottom });
    setOpenId(id);
    closeSubmenuNow();
  }

  const activeMenu = menus.find((m) => m.id === openId) ?? null;

  return (
    <div ref={barRef} className="flex h-full items-center">
      {menus.map((menu) => (
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
              closeSubmenuNow();
            } else {
              openFrom(e.currentTarget, menu.id);
            }
          }}
          // Once a menu is open, hovering a sibling switches to it — standard
          // menu-bar behaviour.
          onMouseEnter={(e) => {
            if (openId !== null && openId !== menu.id) openFrom(e.currentTarget, menu.id);
          }}
          className={`flex h-full items-center px-3 text-[13px] transition-colors ${
            openId === menu.id
              ? "bg-bg-elevated text-fg"
              : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
          }`}
        >
          {t(menu.labelKey)}
        </button>
      ))}
      {activeMenu &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", left: anchor.x, top: anchor.y }}
            className="z-[200] min-w-[220px] overflow-hidden rounded-md border border-border-strong bg-bg-elevated py-1 text-[13px] shadow-lg"
          >
            {activeMenu.items.map((item, index) => {
              const previous = activeMenu.items[index - 1];
              const newGroup = previous !== undefined && previous.group !== item.group;
              const disabled = item.disabled?.(ctx) ?? false;
              const isSubmenuOpen = submenuId === item.id;
              return (
                <div key={item.id} className="relative">
                  {newGroup && <div className="my-1 h-px bg-border" />}
                  <MenuItemRow
                    item={item}
                    disabled={disabled}
                    shortcutHint={shortcutHint(item.shortcut)}
                    isSubmenuOpen={isSubmenuOpen}
                    onSelect={() => onItemSelect(item)}
                    onSubmenuEnter={(rect) => {
                      // Re-entering the row that owns the open flyout (or
                      // entering a different submenu row, handled the same
                      // way) is itself a cancel: there is no pending close to
                      // honor once the cursor is back on a submenu row.
                      clearSubmenuCloseTimer();
                      setSubmenuAnchor({ x: rect.right, y: rect.top });
                      setSubmenuId(item.id);
                    }}
                    onSiblingEnter={scheduleSubmenuClose}
                  />
                  {item.submenu && isSubmenuOpen && submenuAnchor && (
                    <div
                      role="menu"
                      // The cursor reaching the flyout — even via a row deep
                      // inside it that has no handler of its own — cancels
                      // any close scheduled by the sibling-row it crossed to
                      // get here.
                      onMouseEnter={clearSubmenuCloseTimer}
                      style={{ position: "fixed", left: submenuAnchor.x, top: submenuAnchor.y }}
                      className="z-[210] min-w-[180px] overflow-hidden rounded-md border border-border-strong bg-bg-elevated py-1 text-[13px] shadow-lg"
                    >
                      {item.submenu.map((child) => (
                        <MenuItemRow
                          key={child.id}
                          item={child}
                          disabled={child.disabled?.(ctx) ?? false}
                          shortcutHint={shortcutHint(child.shortcut)}
                          isSubmenuOpen={false}
                          onSelect={() => onItemSelect(child)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * Custom title bar for both platforms. On Windows the native frame is hidden
 * (`decorations(false)`): a self-drawn text menu bar sits on the left, a
 * draggable region fills the middle, and the minimize / maximize-restore / close
 * controls sit on the right — each control group is kept non-draggable so clicks
 * aren't swallowed by the drag region. On macOS the native frame stays (overlay
 * title bar, traffic lights) but the native menu is reduced to the system
 * minimum (App + Edit — see menu.rs), so this same menu bar renders there too,
 * offset by a fixed-width inset that reserves space for the traffic lights.
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

  return (
    <div className="flex h-8 shrink-0 items-center border-b border-border bg-bg-inset">
      {!IS_WINDOWS && (
        // Reserves space for the native traffic lights (overlay title bar), so
        // the menu bar/brand mark never renders underneath them. 78px is the
        // standard macOS overlay traffic-light width.
        <div
          data-testid="traffic-light-inset"
          data-tauri-drag-region
          className="h-full w-[78px] shrink-0"
        />
      )}
      {/* Brand mark. Kept a drag region so the window can be moved from here;
          the img/span aren't interactive, so dragging still works. */}
      <div
        data-tauri-drag-region
        className="flex h-full select-none items-center gap-1.5 pl-2.5 pr-1"
      >
        <img src="/icon.png" alt="" className="h-4 w-4 rounded-sm" draggable={false} />
        <span className="text-[13px] font-semibold text-fg">{t("appName")}</span>
      </div>
      <WindowMenuBar />
      <div data-tauri-drag-region className="h-full flex-1" />
      {IS_WINDOWS && (
        <div className="flex h-full shrink-0 items-center">
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
        </div>
      )}
    </div>
  );
}
