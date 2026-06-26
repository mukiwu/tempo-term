import { invoke } from "@tauri-apps/api/core";

/**
 * A snapshot of system metrics from the Rust `system_stats` command. Field names
 * match the backend's camelCase serde output. `cpuUsage` is 0–100 across all
 * cores; `ramUsed` / `ramTotal` are in bytes; `netRx` / `netTx` are bytes per
 * second since the previous poll.
 */
export interface SystemStats {
  cpuUsage: number;
  ramUsed: number;
  ramTotal: number;
  netRx: number;
  netTx: number;
}

/** Fetch one system-metrics snapshot from the backend. */
export function fetchSystemStats(): Promise<SystemStats> {
  return invoke<SystemStats>("system_stats");
}
