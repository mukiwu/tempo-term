import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface VirtualRows {
  /** Attach to the scroll container. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Wire to the scroll container's onScroll. */
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  /** First row index to render (inclusive). */
  start: number;
  /** Last row index to render (exclusive). */
  end: number;
  /** Pixel offset of the first rendered row, for a translateY spacer. */
  offsetTop: number;
  /** Full scroll height the rows occupy, for the spacer that reserves space. */
  totalHeight: number;
}

interface Options {
  /**
   * When the rows do not start at the top of the scroll container (e.g. a list
   * below a header that scrolls with it), point this at the rows' wrapper so the
   * visible window is measured relative to its position. Omit when the rows fill
   * the container, keeping a single scrollbar over header + rows.
   */
  listRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Fixed-height row windowing: render only the rows inside the scroll viewport
 * (plus an overscan margin) so a list of thousands of equal-height rows costs a
 * constant number of DOM nodes. Shared by the diff viewer and the changed-files
 * list. Pass `resetKey` (e.g. the commit hash or diff identity) to scroll back
 * to the top when the underlying data is replaced.
 */
export function useVirtualRows(
  count: number,
  rowHeight: number,
  overscan: number,
  resetKey: unknown,
  options: Options = {},
): VirtualRows {
  const { listRef } = options;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 360 });
  // Offset of the rows within the scroll content. Stays 0 when no listRef is
  // given (rows fill the container).
  const [listTop, setListTop] = useState(0);

  // Track the real container height (and the rows' offset) so the window covers
  // the full visible area even before the first scroll, and recompute on resize
  // — including width changes from the panel resizer, which can re-wrap a header
  // and shift the rows down.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const sync = () => {
      setViewport((prev) => ({ ...prev, height: element.clientHeight }));
      if (listRef?.current) {
        setListTop(listRef.current.offsetTop);
      }
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [listRef]);

  // Re-measure the rows' offset once new content has laid out (a longer commit
  // message pushes the file list further down).
  useLayoutEffect(() => {
    if (listRef?.current) {
      setListTop(listRef.current.offsetTop);
    }
  }, [listRef, resetKey, count]);

  // New data replaces the rows; jump back to the top so the viewport is not left
  // scrolled past the (possibly shorter) new content.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    setViewport((prev) => ({ ...prev, scrollTop: 0 }));
  }, [resetKey]);

  const scrolledIntoRows = viewport.scrollTop - listTop;
  const start = Math.max(0, Math.floor(scrolledIntoRows / rowHeight) - overscan);
  const end = Math.min(
    count,
    Math.ceil((scrolledIntoRows + viewport.height) / rowHeight) + overscan,
  );

  return {
    scrollRef,
    onScroll: (event) => {
      const target = event.currentTarget;
      setViewport({ scrollTop: target.scrollTop, height: target.clientHeight });
    },
    start,
    end,
    offsetTop: start * rowHeight,
    totalHeight: count * rowHeight,
  };
}
