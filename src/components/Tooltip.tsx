import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  /** Falsy label = render children only, never show a tooltip. */
  label: string | null | undefined | false;
  side?: "bottom" | "top" | "right";
  /** Delay before showing, ms. A uniform default keeps busy rows (tabs, tree) quiet. */
  delayMs?: number;
  /** Extra classes for the wrapper span (layout compat: flex-1, min-w-0, w-full…). */
  className?: string;
  children: ReactNode;
}

const MARGIN = 6;
const DEFAULT_DELAY_MS = 300;

/**
 * Lets a nested Tooltip silence its nearest ancestor Tooltip while hovered, so
 * wrapping a whole card in a Tooltip doesn't stack a second tooltip on top of
 * the ones already inside it (PR badge, session rows).
 */
const TooltipNestingContext = createContext<{ suppress(): void; release(): void } | null>(null);

/**
 * A hover tooltip rendered through a portal with fixed positioning, clamped to
 * stay within the viewport. WebKit (the macOS WebView) often won't show native
 * `title` tooltips, and a CSS one would be clipped by the sidebar's overflow —
 * a portal plus clamping sidesteps both.
 */
export function Tooltip({
  label,
  // Top by default: the cursor arrow extends down-right, so a tooltip below
  // the anchor sits under the pointer. Only top-of-window chrome (tab bar,
  // title bar, sidebar icon strip) opens downward.
  side = "top",
  delayMs = DEFAULT_DELAY_MS,
  className,
  children,
}: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const parent = useContext(TooltipNestingContext);
  // Count of hovered nested tooltips; while positive this one stays hidden.
  const suppressedRef = useRef(0);
  // Whether this tooltip currently holds a suppression on its parent.
  const holdRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setAnchor(null);
    setPos(null);
  }, []);

  useEffect(() => cancel, [cancel]);

  // A label that turns falsy while shown (e.g. a hint tied to a disabled
  // state that just re-enabled) hides the tooltip.
  useEffect(() => {
    if (!label) {
      cancel();
    }
  }, [label, cancel]);

  const arm = useCallback(() => {
    if (!label || suppressedRef.current > 0 || timerRef.current !== null) {
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // Absolutely-positioned children (git graph nodes) leave the wrapper
      // zero-sized, so anchor on the child element when there is one.
      const el = anchorRef.current?.firstElementChild ?? anchorRef.current;
      setAnchor(el?.getBoundingClientRect() ?? null);
    }, delayMs);
  }, [label, delayMs]);

  const nesting = useMemo(
    () => ({
      suppress() {
        suppressedRef.current += 1;
        cancel();
      },
      release() {
        suppressedRef.current = Math.max(0, suppressedRef.current - 1);
        // Re-arm for the case where the pointer moved off the nested tooltip
        // but is still over this one. If it left both, this wrapper's own
        // mouseleave fires right after (leave events go bottom-up) and cancels.
        if (suppressedRef.current === 0) {
          arm();
        }
      },
    }),
    [arm, cancel],
  );

  // A nested tooltip unmounting mid-hover (e.g. its row disappears) never
  // fires mouseleave, so give the suppression back here instead.
  useEffect(
    () => () => {
      if (holdRef.current) {
        holdRef.current = false;
        parent?.release();
      }
    },
    [parent],
  );

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
      onMouseEnter={() => {
        if (parent && !holdRef.current) {
          holdRef.current = true;
          parent.suppress();
        }
        arm();
      }}
      onMouseLeave={() => {
        if (parent && holdRef.current) {
          holdRef.current = false;
          parent.release();
        }
        cancel();
      }}
      onMouseDownCapture={cancel}
      className={className ? `inline-flex ${className}` : "inline-flex"}
    >
      <TooltipNestingContext.Provider value={nesting}>{children}</TooltipNestingContext.Provider>
      {label &&
        anchor &&
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
