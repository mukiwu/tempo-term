import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Whether an element's content overflows horizontally (its `truncate` ellipsis
 * is showing). Attach the returned callback ref to the truncating element; the
 * flag follows element resizes (ResizeObserver) and text changes, so a tooltip
 * gated on it only appears when the full text is actually hidden.
 */
export function useIsTruncated(text: string): [(el: HTMLElement | null) => void, boolean] {
  const [truncated, setTruncated] = useState(false);
  const elRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const attach = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    elRef.current = el;
    if (!el) {
      setTruncated(false);
      return;
    }
    const check = () => setTruncated(el.scrollWidth > el.clientWidth);
    check();
    // jsdom has no ResizeObserver; there the initial check (0 > 0) stands.
    if (typeof ResizeObserver !== "undefined") {
      observerRef.current = new ResizeObserver(check);
      observerRef.current.observe(el);
    }
  }, []);

  // Re-measure when the text changes without the element remounting.
  useLayoutEffect(() => {
    const el = elRef.current;
    if (el) {
      setTruncated(el.scrollWidth > el.clientWidth);
    }
  }, [text]);

  return [attach, truncated];
}
