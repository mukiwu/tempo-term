import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export interface LogEntry {
  name: string;
  size: number;
  modified_unix_ms: number;
}

export function listSessionLogs(): Promise<LogEntry[]> {
  return invoke<LogEntry[]>("session_logs_list");
}

export async function readSessionLog(name: string): Promise<Uint8Array> {
  // tauri::ipc::Response delivers raw binary as an ArrayBuffer on the frontend
  // (not Uint8Array), so we wrap it explicitly.
  const buf = await invoke<ArrayBuffer>("session_log_read", { name });
  return new Uint8Array(buf);
}

export function openSessionLogsDir(): Promise<void> {
  return invoke<void>("session_logs_open_dir");
}

export function enforceLogRetention(retentionDays: number | null): Promise<void> {
  return invoke<void>("session_logs_enforce_retention", { retentionDays });
}

/** Native Save As dialog defaulting to a suggested name; writes `content` to
 *  the chosen path. No-op if the user cancels. Returns the saved path or null. */
export async function saveTextAs(suggestedName: string, content: string): Promise<string | null> {
  const path = await save({ defaultPath: suggestedName });
  if (!path) return null;
  await invoke<void>("fs_write_file", { path, contents: content });
  return path;
}
