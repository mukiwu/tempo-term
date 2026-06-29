import { invoke } from "@tauri-apps/api/core";

/**
 * One listening port plus its owning process, from the Rust `list_ports`
 * command. Field names match the backend camelCase serde output. `cpuUsage` is
 * 0-100; `memoryBytes` is bytes; `uptimeSecs` is seconds the process has run;
 * `command` and `cwd` are null when the process cannot be inspected.
 */
export interface PortInfo {
  port: number;
  protocol: string;
  bindAddr: string;
  pid: number;
  processName: string;
  command: string | null;
  cwd: string | null;
  cpuUsage: number;
  memoryBytes: number;
  uptimeSecs: number;
  isCurrentUser: boolean;
}

/** Fetch the current listening ports. `showAll` removes the current-user filter. */
export function fetchPorts(showAll: boolean): Promise<PortInfo[]> {
  return invoke<PortInfo[]>("list_ports", { showAll });
}

/**
 * Kill the process holding a port. Passes both port and pid so the backend can
 * confirm the pid still listens on that port before killing (PID-reuse guard).
 * Rejects with a message on failure.
 */
export function killPortProcess(port: number, pid: number): Promise<void> {
  return invoke("kill_port_process", { port, pid });
}
