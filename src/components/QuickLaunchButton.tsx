import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Plus, type LucideIcon } from "lucide-react";
import { useTabsStore } from "@/stores/tabsStore";
import { ConnectionForm } from "@/modules/ssh/ConnectionForm";
import { Tooltip } from "./Tooltip";
import { useLauncherActions } from "./LauncherPanel";

/** Hover delay before the strip opens, so passing over the button on the way
 *  elsewhere does not flash it. */
const OPEN_DELAY_MS = 120;
/** Grace period after the pointer leaves before the strip closes, so moving
 *  from the button onto the strip (or briefly overshooting) keeps it open. */
const CLOSE_DELAY_MS = 220;
/** Matches the strip's exit transition before it unmounts. */
const EXIT_MS = 150;
/** The strip's inner padding, so its leading plus lands on the button. */
const STRIP_PADDING = 5;
/** Space kept between the strip and whatever bounds it on the right. */
const EDGE_GAP = 8;

interface StripPosition {
  top: number;
  left: number;
}

/**
 * One round icon button on the strip. The hover tint is driven by mouse
 * events rather than CSS `:hover`, which WKWebView applies unreliably on
 * pop-up overlays like this one.
 */
function StripButton({ label, icon: Icon, accent, onClick }: {
  label: string;
  icon: LucideIcon;
  /** Tints the icon with the accent color even when not hovered. */
  accent?: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-[color,background-color,scale] active:scale-[0.96] ${
        hovered ? "bg-accent/15 text-accent" : accent ? "text-accent" : "text-fg-muted"
      }`}
    >
      <Icon size={16} />
    </button>
  );
}

interface QuickLaunchButtonProps {
  /** The element whose right edge the strip must not cross (the tab bar), so
   *  the strip opens leftward over the tabs when the space after the button
   *  is too narrow. */
  boundsRef: React.RefObject<HTMLElement | null>;
}

/**
 * The tab bar's add button. A click opens the launcher tab as before; hovering
 * slides out a strip of the launcher's actions as icons so one can be opened
 * directly. The strip opens to the right of the button, and is shifted left
 * over the tabs when the bar does not have room for it.
 */
export function QuickLaunchButton({ boundsRef }: QuickLaunchButtonProps) {
  const { t } = useTranslation();
  const openLauncherTab = useTabsStore((s) => s.openLauncherTab);
  const { groups, sshFormOpen, setSshFormOpen } = useLauncherActions();
  const actions = groups.flatMap((group) => group.actions);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  // `mounted` keeps the strip in the DOM through its exit transition;
  // `shown` drives the transition itself.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [position, setPosition] = useState<StripPosition | null>(null);

  function clearTimer() {
    window.clearTimeout(timerRef.current);
  }

  function scheduleOpen() {
    clearTimer();
    if (mounted) {
      // Re-entered during the exit transition: bring it straight back.
      if (position) {
        setShown(true);
      }
      return;
    }
    timerRef.current = window.setTimeout(() => setMounted(true), OPEN_DELAY_MS);
  }

  function scheduleClose(delay = CLOSE_DELAY_MS) {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      setShown(false);
      timerRef.current = window.setTimeout(() => {
        setMounted(false);
        setPosition(null);
      }, EXIT_MS);
    }, delay);
  }

  useEffect(() => clearTimer, []);

  // Place the strip aligned with the button's left edge, vertically centred
  // on it, and pulled left as far as needed to stay inside the tab bar. Runs
  // on open and again whenever the window, the tab bar or the button resizes,
  // so the strip follows the button while it is open.
  useLayoutEffect(() => {
    if (!mounted) {
      return;
    }
    function place() {
      const button = buttonRef.current?.getBoundingClientRect();
      const strip = stripRef.current;
      if (!button || !strip) {
        return;
      }
      const limit = (boundsRef.current?.getBoundingClientRect().right ?? window.innerWidth) - EDGE_GAP;
      const left = Math.max(EDGE_GAP, Math.min(button.left - STRIP_PADDING, limit - strip.offsetWidth));
      const top = button.top + button.height / 2 - strip.offsetHeight / 2;
      setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    }
    place();
    window.addEventListener("resize", place);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    for (const el of [boundsRef.current, buttonRef.current]) {
      if (el) {
        observer?.observe(el);
      }
    }
    return () => {
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
  }, [mounted, boundsRef]);

  // Fade in on the frame after the first placement, so the transition has a
  // start state. Later re-placements must not re-show a closing strip.
  const placed = position !== null;
  useEffect(() => {
    if (!placed) {
      return;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [placed]);

  // Closes when keyboard focus leaves both the button and the strip.
  function onBlur(e: React.FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (next && (buttonRef.current?.contains(next) || stripRef.current?.contains(next))) {
      return;
    }
    scheduleClose();
  }

  useEffect(() => {
    if (!mounted) {
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        scheduleClose(0);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // scheduleClose only touches refs and state setters, so it never goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("workspace.addTab")}
        aria-expanded={shown}
        onClick={() => {
          // A committed click wins over a pending hover-open.
          scheduleClose(0);
          openLauncherTab();
        }}
        onMouseEnter={scheduleOpen}
        onMouseLeave={() => scheduleClose()}
        onFocus={scheduleOpen}
        onBlur={onBlur}
        className="flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-md text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
      >
        <Plus size={16} />
      </button>
      {mounted &&
        createPortal(
          <div
            ref={stripRef}
            role="toolbar"
            aria-orientation="horizontal"
            aria-label={t("workspace.addTab")}
            onMouseEnter={scheduleOpen}
            onMouseLeave={() => scheduleClose()}
            onFocus={scheduleOpen}
            onBlur={onBlur}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              visibility: position ? "visible" : "hidden",
            }}
            className={`fixed z-50 flex items-center gap-0.5 rounded-full border border-accent/40 bg-bg-elevated p-1 shadow-[0_8px_24px_rgb(0_0_0/0.35)] transition-[opacity,translate,scale] duration-150 ease-out ${
              shown ? "translate-x-0 scale-100 opacity-100" : "pointer-events-none -translate-x-1 scale-[0.97] opacity-0"
            }`}
          >
            {/* Leading plus keeps the click target under the pointer: the
                strip opens over the add button, so this opens the launcher
                tab exactly as the button would. */}
            <StripButton
              label={t("workspace.addTab")}
              icon={Plus}
              accent
              onClick={() => {
                scheduleClose(0);
                openLauncherTab();
              }}
            />
            <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />
            {actions.map(({ key, label, icon, run }) => (
              <Tooltip key={key} label={label} side="bottom" className="shrink-0">
                <StripButton
                  label={label}
                  icon={icon}
                  onClick={() => {
                    scheduleClose(0);
                    void run();
                  }}
                />
              </Tooltip>
            ))}
          </div>,
          document.body,
        )}
      {sshFormOpen && <ConnectionForm onClose={() => setSshFormOpen(false)} />}
    </>
  );
}
