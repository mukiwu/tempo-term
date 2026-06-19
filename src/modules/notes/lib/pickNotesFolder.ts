import { open } from "@tauri-apps/plugin-dialog";

/**
 * Prompt the user to pick the folder that backs global notes. Returns the
 * chosen absolute path, or null if the dialog was cancelled.
 */
export async function pickNotesFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  if (Array.isArray(result)) {
    return result[0] ?? null;
  }
  return typeof result === "string" ? result : null;
}
