import { invoke } from "@tauri-apps/api/core";

/** The auto title for a directory's newest Claude session, or null if none. */
export function claudeSessionTitle(cwd: string): Promise<string | null> {
  return invoke<string | null>("claude_session_title", { cwd });
}
