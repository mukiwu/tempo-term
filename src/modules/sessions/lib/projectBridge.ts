import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary } from "./sessionsBridge";

/** Per-project aggregates + recent sessions for the project view. Field names
 *  mirror the Rust `ProjectStats` serde output exactly. */
export interface ProjectStats {
  project_cwd: string;
  sessions: number;
  messages: number;
  output_tokens: number;
  active_days: number;
  top_model: string | null;
  first_at: number;
  last_at: number;
  recent: SessionSummary[];
}

/** Aggregates for one project. Zeroed (never rejects) for an unknown project. */
export function sessionsProjectStats(projectCwd: string): Promise<ProjectStats> {
  return invoke<ProjectStats>("sessions_project_stats", { projectCwd });
}
