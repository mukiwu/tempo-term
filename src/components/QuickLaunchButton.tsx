import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
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

  // Place the strip once it is in the DOM and its width is known: aligned with
  // the button's left edge, vertically centred on it, and pulled left as far
  // as needed to stay inside the tab bar.
  useLayoutEffect(() => {
    if (!mounted || position) {
      return;
    }
    const button = buttonRef.current?.getBoundingClientRect();
    const strip = stripRef.current?.getBoundingClientRect();
    if (!button || !strip) {
      return;
    }
    const limit = (boundsRef.current?.getBoundingClientRect().right ?? window.innerWidth) - EDGE_GAP;
    const left = Math.max(EDGE_GAP, Math.min(button.left - STRIP_PADDING, limit - strip.width));
    setPosition({ top: button.top + button.height / 2 - strip.height / 2, left });
  }, [mounted, position, boundsRef]);

  // Fade in on the frame after positioning, so the transition has a start state.
  useEffect(() => {
    if (!position) {
      return;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [position]);

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
  });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("workspace.addTab")}
        aria-haspopup="menu"
        aria-expanded={shown}
        onClick={() => openLauncherTab()}
        onMouseEnter={scheduleOpen}
        onMouseLeave={() => scheduleClose()}
        onFocus={scheduleOpen}
        className="flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-md text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
      >
        <Plus size={16} />
      </button>
      {mounted &&
        createPortal(
          <div
            ref={stripRef}
            role="menu"
            aria-label={t("workspace.addTab")}
            onMouseEnter={scheduleOpen}
            onMouseLeave={() => scheduleClose()}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              visibility: position ? "visible" : "hidden",
            }}
            className={`fixed z-50 flex items-center gap-0.5 rounded-full border border-accent/40 bg-bg-elevated p-1 shadow-[0_8px_24px_rgb(0_0_0/0.35)] transition-[opacity,translate,scale] duration-150 ease-out ${
              shown ? "translate-x-0 scale-100 opacity-100" : "-translate-x-1 scale-[0.97] opacity-0"
            }`}
          >
            {/* Leading plus keeps the click target under the pointer: the
                strip opens over the add button, so this opens the launcher
                tab exactly as the button would. */}
            <button
              type="button"
              role="menuitem"
              aria-label={t("workspace.addTab")}
              onClick={() => {
                scheduleClose(0);
                openLauncherTab();
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-accent transition-[background-color,scale] hover:bg-accent/15 active:scale-[0.96]"
            >
              <Plus size={16} />
            </button>
            <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />
            {actions.map(({ key, label, icon: Icon, run }) => (
              <Tooltip key={key} label={label} side="bottom" className="shrink-0">
                <button
                  type="button"
                  role="menuitem"
                  aria-label={label}
                  onClick={() => {
                    scheduleClose(0);
                    void run();
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-fg-muted transition-[color,background-color,scale] hover:bg-accent/15 hover:text-accent active:scale-[0.96]"
                >
                  <Icon size={16} />
                </button>
              </Tooltip>
            ))}
          </div>,
          document.body,
        )}
      {sshFormOpen && <ConnectionForm onClose={() => setSshFormOpen(false)} />}
    </>
  );
}
