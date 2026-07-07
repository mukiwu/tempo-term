import { open, save } from "@tauri-apps/plugin-dialog";

/** Prompt the user to pick a single folder. Returns null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}

/** Prompt the user to pick a single file. Returns null if cancelled. */
export async function pickFile(): Promise<string | null> {
  const result = await open({ directory: false, multiple: false });
  return typeof result === "string" ? result : null;
}

/** Prompt the user to pick a save location for a Markdown file, pre-filled
 *  with `defaultPath` (typically a suggested filename). Returns null if
 *  cancelled — the caller should treat that as a no-op, not an error. */
export async function saveFile(defaultPath: string): Promise<string | null> {
  const result = await save({ defaultPath, filters: [{ name: "Markdown", extensions: ["md"] }] });
  return typeof result === "string" ? result : null;
}
