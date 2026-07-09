import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Minus, Square, X } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useOverlayGuard } from "@/lib/overlayGuard";
import { IS_WINDOWS } from "@/lib/platform";
import {
  closeWindow,
  emitWindowMenuEvent,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  toggleMaximizeWindow,
} from "@/lib/window";

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

interface MenuBarItem {
  id: string;
  label: string;
  /** Shortcut hint shown right-aligned (Windows Ctrl-based). */
  shortcut?: string;
  onSelect: () => void;
  /** Group index; a thin divider separates consecutive groups. */
  group?: number;
}

interface MenuBarMenu {
  id: string;
  label: string;
  items: MenuBarItem[];
}

/**
 * Text menu bar (File / Window) for the Windows title bar. The native Windows
 * menu bar is gone because the frame is hidden (`decorations(false)`) — and even
 * if shown it is OS-drawn and can't follow the app's theme. This self-drawn menu
 * uses the same CSS tokens as the rest of the UI, so it recolours with the theme.
 *
 * Each item runs the exact same action as its macOS menu counterpart in menu.rs:
 * New Window / Close Window act directly (invoke / closeWindow, mirroring the
 * Rust handler's direct calls), while the frontend-driven items fire the same
 * scoped `menu:*` event the Rust side emits, so App.tsx's existing listeners stay
 * the single source of truth for what each action does.
 */
function WindowMenuBar() {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The native preview webview floats above all DOM, so hide it while a menu is
  // open or it would cover the dropdown (same guard ContextMenu uses).
  useOverlayGuard(openId !== null);

  const menus: MenuBarMenu[] = [
    {
      id: "file",
      label: t("menuBar.file"),
      items: [
        {
          id: "new-window",
          label: t("menuBar.newWindow"),
          shortcut: "Ctrl+N",
          group: 0,
          onSelect: () => void invoke("open_new_window").catch(() => {}),
        },
        {
          id: "open-location",
          label: t("menuBar.openLocation"),
          shortcut: "Ctrl+L",
          group: 1,
          onSelect: () => void emitWindowMenuEvent("menu:preview-open-location"),
        },
        {
          id: "setup-wizard",
          label: t("menuBar.setupWizard"),
          group: 2,
          onSelect: () => void emitWindowMenuEvent("menu:rerun-setup"),
        },
        {
          id: "close-tab",
          label: t("menuBar.closeTab"),
          shortcut: "Ctrl+W",
          group: 3,
          onSelect: () => void emitWindowMenuEvent("menu:close-tab"),
        },
      ],
    },
    {
      id: "window",
      label: t("menuBar.window"),
      items: [
        {
          id: "cycle-pane",
          label: t("menuBar.cyclePane"),
          shortcut: "Ctrl+`",
          onSelect: () => void emitWindowMenuEvent("menu:focus-next-pane"),
        },
        {
          id: "close-window",
          label: t("menuBar.closeWindow"),
          shortcut: "Ctrl+Shift+W",
          onSelect: () => void closeWindow(),
        },
      ],
    },
  ];

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
      if (event.key === "Escape") setOpenId(null);
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
    setAnchor({ x: rect.left, y: rect.bottom });
    setOpenId(id);
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
          className={`flex h-full items-center px-3 text-[13px] transition-colors ${
            openId === menu.id
              ? "bg-bg-elevated text-fg"
              : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
          }`}
        >
          {menu.label}
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
              const newGroup =
                previous !== undefined && (previous.group ?? 0) !== (item.group ?? 0);
              return (
                <div key={item.id}>
                  {newGroup && <div className="my-1 h-px bg-border" />}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpenId(null);
                      item.onSelect();
                    }}
                    className="flex w-full items-center gap-6 px-3 py-1.5 text-left text-fg-muted transition-colors hover:bg-bg hover:text-fg"
                  >
                    <span className="truncate">{item.label}</span>
                    {item.shortcut && (
                      <span className="ml-auto text-[11px] text-fg-subtle">{item.shortcut}</span>
                    )}
                  </button>
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
 * Custom title bar for Windows, where the native frame is hidden
 * (`decorations(false)`). A self-drawn text menu bar sits on the left, a
 * draggable region fills the middle, and the minimize / maximize-restore / close
 * controls sit on the right — each control group is kept non-draggable so clicks
 * aren't swallowed by the drag region. Renders nothing on macOS, which keeps its
 * native overlay title bar (and native menu).
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
    <div className="flex h-8 shrink-0 items-center border-b border-border bg-bg-inset">
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
    </div>
  );
}
