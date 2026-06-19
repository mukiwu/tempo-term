/**
 * Resolve `work` but never before `minMs` has elapsed. Used to keep a busy
 * indicator (e.g. the refresh spinner) on screen long enough to be perceived
 * when the underlying operation finishes almost instantly. If `work` rejects,
 * the rejection propagates immediately without waiting out the minimum.
 */
export async function withMinDuration<T>(work: Promise<T>, minMs: number): Promise<T> {
  const [result] = await Promise.all([
    work,
    new Promise<void>((resolve) => setTimeout(resolve, minMs)),
  ]);
  return result;
}
