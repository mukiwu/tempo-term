import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Frontend wrappers around the Rust sessions index (Task 8): a metadata-only
 * SQLite cache of historical Claude Code / Codex / Antigravity CLI sessions,
 * kept in sync by filesystem watchers. Message bodies are never cached —
 * `sessionsGet` re-parses them from the source file on demand.
 */

export type SessionAgent = "claude" | "codex" | "antigravity";

export interface SessionSummary {
  id: string;
  agent: SessionAgent;
  project_cwd: string;
  title: string;
  started_at: number;
  ended_at: number;
  message_count: number;
  user_message_count: number;
  output_tokens: number | null;
  model: string | null;
  file_path: string;
  pinned: boolean;
}

export interface TranscriptMessage {
  /** "injected" marks harness-generated turns recorded as user input
   *  (teammate messages, system reminders, task notifications, command
   *  envelopes); `tool_name` then carries the source tag. */
  role: "user" | "assistant" | "tool" | "system" | "injected";
  text: string;
  timestamp: number | null;
  tool_name: string | null;
}

/** Opens the index, starts the filesystem watchers, and kicks off a
 *  background full sync. Safe to call more than once. */
export function sessionsStart(): Promise<void> {
  return invoke("sessions_index_start");
}

/** Every indexed session, newest-first, pinned sessions flagged. Empty
 *  before `sessionsStart` has run. */
export function sessionsList(): Promise<SessionSummary[]> {
  return invoke<SessionSummary[]>("sessions_list");
}

/** Re-parses a session's full transcript from its source file. */
export function sessionsGet(id: string): Promise<TranscriptMessage[]> {
  return invoke<TranscriptMessage[]>("sessions_get", { id });
}

/** Pins or unpins a session. */
export function sessionsPin(id: string, pinned: boolean): Promise<void> {
  return invoke("sessions_pin", { id, pinned });
}

/** Subscribes to `sessions-index:updated`, emitted whenever a background
 *  sync batch changes the index. Resolves with an unlisten function. */
export function onSessionsUpdated(cb: () => void): Promise<() => void> {
  return listen<{ count: number }>("sessions-index:updated", () => cb());
}
