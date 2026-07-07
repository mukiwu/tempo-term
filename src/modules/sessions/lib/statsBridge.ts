import { invoke } from "@tauri-apps/api/core";
import type { SessionAgent } from "./sessionsBridge";

/**
 * Frontend types and wrapper for the Rust `sessions_stats` command: everything
 * the sessions dashboard renders in one round trip — summary cards, an
 * activity heatmap, top sessions by message/token volume, and a per-agent
 * weekly breakdown. Field names mirror the backend's serde output
 * (`src-tauri/src/modules/sessions_index/stats.rs`) exactly, snake_case
 * included, so no mapping layer is needed between the two.
 */

export interface StatsCards {
  sessions: number;
  messages: number;
  user_messages: number;
  /** Distinct non-empty `project_cwd`. */
  projects: number;
  /** Distinct activity dates. */
  active_days: number;
  /** `0` when `sessions === 0`; unrounded, format for display. */
  messages_per_session: number;
  /** Total assistant output tokens in range (0 when none recorded). */
  output_tokens: number;
}

/** One calendar date with activity. Only dates with at least one message are
 *  present — the backend never emits zero-activity days. Carries all three
 *  metrics so the heatmap can toggle what its intensity encodes. */
export interface HeatmapDay {
  date: string;
  messages: number;
  sessions: number;
  output_tokens: number;
}

/** Which per-day metric the activity heatmap shades by. */
export type HeatmapMetric = "messages" | "sessions" | "output_tokens";

export interface TopSession {
  id: string;
  agent: SessionAgent;
  title: string;
  project_cwd: string;
  /** Message count or token count, depending on which top-sessions list this
   *  entry came from. */
  value: number;
}

export interface ModelTokens {
  model: string;
  output_tokens: number;
}

export interface WeeklyAgentRow {
  agent: SessionAgent;
  sessions: number;
  messages: number;
  output_tokens: number;
  models: ModelTokens[];
}

export interface SessionsStats {
  cards: StatsCards;
  /** Ascending by date. */
  heatmap: HeatmapDay[];
  /** Up to 10, ordered by message count descending. */
  top_by_messages: TopSession[];
  /** Up to 10, sessions with tokens only, ordered by tokens descending. */
  top_by_tokens: TopSession[];
  /** Last 7 local days, one row per agent seen in that window — independent
   *  of the `days` range filter. */
  weekly: WeeklyAgentRow[];
  /** Per-model output tokens over the selected range, for the cards' rough
   *  cost estimate. Excludes NULL-model tokens (which are still in
   *  `cards.output_tokens`). */
  range_models: ModelTokens[];
  /** Messages per hour-of-day for today, always length 24 (index 0 = midnight). */
  hourly: number[];
}

/** Fetches aggregated dashboard stats. `days` narrows cards/heatmap/top
 *  sessions to a rolling window; pass `null` for all-time. The weekly digest
 *  always covers the last 7 local days regardless of this value. */
export function sessionsStats(days: number | null): Promise<SessionsStats> {
  return invoke<SessionsStats>("sessions_stats", { days });
}

/** Moves a session's source file (and its companions) to the OS trash, then
 *  drops it from the index. The sessions list itself refreshes via the
 *  `sessions-index:updated` event the backend emits after — this call
 *  doesn't return the updated list. */
export function sessionsDelete(id: string): Promise<void> {
  return invoke("sessions_delete", { id });
}

/** Re-parses a session's transcript and renders it as a Markdown string,
 *  for the export button. Writing the result to disk is the caller's job
 *  (via a save dialog + `fsWriteFile`) — this only produces the content. */
export function sessionsExport(id: string): Promise<string> {
  return invoke<string>("sessions_export", { id });
}
