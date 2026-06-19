/**
 * Resolve `work` but never before `minMs` has elapsed. Used to keep a busy
 * indicator (e.g. the refresh spinner) on screen long enough to be perceived
 * when the underlying operation finishes almost instantly. If `work` rejects,
 * the rejection propagates immediately without waiting out the minimum.
 */
export async function withMinDuration<T>(work: Promise<T>, minMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const delay = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, minMs);
  });
  try {
    const [result] = await Promise.all([work, delay]);
    return result;
  } finally {
    // If `work` rejected before the delay elapsed, drop the dangling timer so it
    // does not leak (notably under fake timers or long-running processes).
    clearTimeout(timeoutId);
  }
}
