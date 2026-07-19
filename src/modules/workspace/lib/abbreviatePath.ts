/**
 * Collapse a macOS (/Users/<name>) or Linux (/home/<name>) home prefix to `~`
 * for display. Windows paths already start at their drive letter (C:\...) and
 * pass through untouched, as does any path outside a home directory.
 */
export function abbreviateHome(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}
