import { invoke } from "@tauri-apps/api/core";

/** The requested Claude session's auto title, or the directory fallback. */
export function claudeSessionTitle(cwd: string, sessionId?: string): Promise<string | null> {
  return invoke<string | null>("claude_session_title", { cwd, sessionId });
}

/**
 * With a session id, returns only that Codex rollout's auto title or null,
 * never a fallback. Without an id, returns the directory's latest title.
 */
export function codexSessionTitle(cwd: string, sessionId?: string): Promise<string | null> {
  return invoke<string | null>("codex_session_title", { cwd, sessionId });
}
