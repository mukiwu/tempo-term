import type { SessionSummary } from "./sessionsBridge";

const HEADER = [
  "title", "agent", "model", "project", "started_at", "ended_at",
  "messages", "user_messages", "output_tokens", "pinned",
] as const;

/** Neutralizes CSV formula injection: a field starting with a formula trigger
 *  (`=` `+` `-` `@`, or a leading tab/CR/LF that a spreadsheet strips to reveal
 *  one) is prefixed with a single quote so it is treated as inert text instead
 *  of executing on open. */
function guardFormula(value: string): string {
  return /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
}

/** RFC-4180 quote: wrap in double quotes and double any inner quote when the
 *  field contains a comma, quote, CR, or LF; otherwise return it unchanged.
 *  Applies the formula guard first so the escaping wraps the guarded value. */
function csvField(value: string): string {
  const guarded = guardFormula(value);
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
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
