import { open } from "@tauri-apps/plugin-dialog";

/** Prompt the user to pick a single folder. Returns null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}
