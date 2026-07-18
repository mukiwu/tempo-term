import { invoke } from "@tauri-apps/api/core";

/** The requested Claude session's auto title, or the directory fallback. */
export function claudeSessionTitle(cwd: string, sessionId?: string): Promise<string | null> {
  return invoke<string | null>("claude_session_title", { cwd, sessionId });
}

/** The auto title for a directory's newest Codex session, or null if none. */
export function codexSessionTitle(cwd: string): Promise<string | null> {
  return invoke<string | null>("codex_session_title", { cwd });
}
