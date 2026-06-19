import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Frontend wrappers around the Rust notes-folder watcher. The backend watches
 * the chosen folder recursively and emits `notes-changed` with the affected
 * paths whenever files change on disk (e.g. a cloud drive syncing in edits).
 */

export function startNotesWatch(path: string): Promise<void> {
  return invoke("notes_watch", { path });
}

export function stopNotesWatch(): Promise<void> {
  return invoke("notes_unwatch");
}

export function onNotesChanged(
  handler: (paths: string[]) => void,
): Promise<UnlistenFn> {
  return listen<{ paths: string[] }>("notes-changed", (event) =>
    handler(event.payload.paths),
  );
}
