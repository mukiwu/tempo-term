/** Format a process uptime in seconds as a compact string like "1d 2h", "3h 45m", "1m", "45s". */
export function formatUptime(secs: number): string {
  if (secs < 60) {
    return `${Math.floor(secs)}s`;
  }
  const minutes = Math.floor(secs / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
