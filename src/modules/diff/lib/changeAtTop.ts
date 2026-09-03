/**
 * Which change the reader is looking at, given where the changes sit.
 *
 * The all-changes page's counter used to move only when its own prev/next
 * buttons were pressed, so scrolling — by hand, or by clicking a row in the
 * Source Control panel — left it stale, and the next press resumed from a
 * position the reader had long since left. Deriving it from the scroll
 * position instead keeps "6/215" true and makes prev/next continue from
 * wherever they are.
 */

/**
 * The 1-based position of the last change at or above `viewportTop`, or 0 when
 * the page is scrolled above the first one.
 *
 * `topOf` is called lazily and the search is binary, so a page with hundreds
 * of changes costs a handful of geometry reads per scroll rather than one per
 * change. It may return null for a change whose editors are not up yet; those
 * are treated as being below the viewport, which is the safe direction — the
 * counter lags rather than jumping ahead of what is on screen.
 */
export function changeAtViewportTop(
  count: number,
  viewportTop: number,
  topOf: (index: number) => number | null,
): number {
  let low = 0;
  let high = count - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const top = topOf(mid);
    if (top === null || top > viewportTop) {
      high = mid - 1;
    } else {
      found = mid + 1;
      low = mid + 1;
    }
  }
  return found;
}
