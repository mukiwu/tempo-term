/**
 * Human-readable formatting for the status-bar system metrics. Pure functions so
 * the display logic is unit-tested without a live system or the Tauri bridge.
 */

const UNITS = ["KB", "MB", "GB", "TB"] as const;

/** Format a byte count as e.g. "0 B", "512 B", "1.5 KB", "1.0 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unitIndex]}`;
}

/** Format a transfer rate, e.g. "0 B/s", "1.0 KB/s", "1.4 MB/s". */
export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

/** Round a 0–100 value to a whole-number percent string, e.g. "43%". */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

/** Used memory as a 0–100 percentage of total; 0 when total is 0. */
export function ramPercent(used: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return (used / total) * 100;
}
