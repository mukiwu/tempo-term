/**
 * Keeps the two diff sides' horizontal scroll positions in lockstep, like
 * VS Code's side-by-side diff. 1:1, not proportional: the side with shorter
 * lines simply stops at its own end while the other keeps going.
 */
export function linkHorizontalScroll(a: HTMLElement, b: HTMLElement): () => void {
  // Swallows exactly the echo event caused by our own assignment, so the
  // clamped side doesn't drag the driving side back to its own maximum.
  let syncing = false;
  const follow = (from: HTMLElement, to: HTMLElement) => () => {
    if (syncing) {
      syncing = false;
      return;
    }
    if (to.scrollLeft !== from.scrollLeft) {
      const before = to.scrollLeft;
      syncing = true;
      to.scrollLeft = from.scrollLeft;
      if (to.scrollLeft === before) {
        // Clamped to the value it already had (target is at its own end):
        // no echo event will fire, so disarm or the flag would eat the
        // next genuine scroll on that side.
        syncing = false;
      }
    }
  };
  const aToB = follow(a, b);
  const bToA = follow(b, a);
  a.addEventListener("scroll", aToB, { passive: true });
  b.addEventListener("scroll", bToA, { passive: true });
  return () => {
    a.removeEventListener("scroll", aToB);
    b.removeEventListener("scroll", bToA);
  };
}
