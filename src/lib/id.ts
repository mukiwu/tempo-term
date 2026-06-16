let sequence = 0;

/**
 * Generate a unique id. Combines the wall clock with a per-session sequence so
 * ids never collide with ones restored from a previous session (a plain
 * counter would restart at 1 and clash with persisted ids).
 */
export function uid(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}
