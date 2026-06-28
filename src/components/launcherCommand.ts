/**
 * Build the shell command a launcher entry runs, appending the user's
 * configured default flags to the base command (e.g. `claude`, `codex`).
 */
export function buildLauncherCommand(base: string, flags: string): string {
  const trimmed = flags.trim();
  return trimmed ? `${base} ${trimmed}` : base;
}
