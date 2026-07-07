import type { SessionSummary } from "./sessionsBridge";

const HEADER = [
  "title", "agent", "model", "project", "started_at", "ended_at",
  "messages", "user_messages", "output_tokens", "pinned",
] as const;

/** RFC-4180 quote: wrap in double quotes and double any inner quote when the
 *  field contains a comma, quote, CR, or LF; otherwise return it unchanged. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serializes sessions to RFC-4180 CSV: a fixed header row then one row per
 *  session. A null `output_tokens`/`model` becomes an empty field. Timestamps
 *  are the raw epoch-ms numbers (stable, spreadsheet-parseable). */
export function toSessionsCsv(sessions: SessionSummary[]): string {
  const rows = sessions.map((s) =>
    [
      s.title,
      s.agent,
      s.model ?? "",
      s.project_cwd,
      String(s.started_at),
      String(s.ended_at),
      String(s.message_count),
      String(s.user_message_count),
      s.output_tokens === null ? "" : String(s.output_tokens),
      String(s.pinned),
    ]
      .map(csvField)
      .join(","),
  );
  return [HEADER.join(","), ...rows].join("\n");
}
