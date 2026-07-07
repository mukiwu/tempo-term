import { describe, expect, it } from "vitest";
import { toSessionsCsv } from "./sessionsCsv";
import type { SessionSummary } from "./sessionsBridge";

const s = (o: Partial<SessionSummary>): SessionSummary => ({
  id: "id", agent: "claude", project_cwd: "/p", title: "t", started_at: 0, ended_at: 0,
  message_count: 0, user_message_count: 0, output_tokens: null, model: null,
  file_path: "/f", pinned: false, ...o,
});

describe("toSessionsCsv", () => {
  it("writes a header row plus one row per session in field order", () => {
    const csv = toSessionsCsv([s({ title: "Fix bug", agent: "codex", model: "gpt-5.5", message_count: 12 })]);
    const [header, row] = csv.split("\n");
    expect(header).toBe("title,agent,model,project,started_at,ended_at,messages,user_messages,output_tokens,pinned");
    expect(row.startsWith("Fix bug,codex,gpt-5.5,/p,")).toBe(true);
    expect(row.endsWith(",12,0,,false")).toBe(true); // null output_tokens → empty field
  });

  it("quotes and escapes fields containing commas, quotes, or newlines", () => {
    const csv = toSessionsCsv([s({ title: 'a,"b"\nc' })]);
    const row = csv.split("\n").slice(1).join("\n"); // field itself contains a newline
    expect(row.startsWith('"a,""b""\nc",claude,')).toBe(true);
  });

  it("emits an empty model field for a null model", () => {
    const csv = toSessionsCsv([s({ agent: "codex", model: null, project_cwd: "/proj" })]);
    const row = csv.split("\n")[1];
    const fields = row.split(",");
    // Header order is title,agent,model,project,... — model is index 2, and
    // must be empty (the `s.model ?? ""` branch), not the literal "null".
    expect(fields[1]).toBe("codex");
    expect(fields[2]).toBe("");
    expect(fields[3]).toBe("/proj");
  });

  it("neutralizes spreadsheet formula-injection by prefixing a leading =,+,-,@", () => {
    // A title starting with a formula trigger would execute on open in
    // Excel/Sheets; it must be prefixed with a single quote so it's inert text.
    const csv = toSessionsCsv([s({ title: "=SUM(A1:A9)" })]);
    const row = csv.split("\n")[1];
    // Leading "=" makes the guarded value start with "'=", and the "'" alone
    // does not force quoting, so the field is the bare prefixed string.
    expect(row.startsWith("'=SUM(A1:A9),")).toBe(true);
  });

  it("keeps the formula guard inside RFC-4180 quoting when the field also needs quoting", () => {
    // Leading "@" AND a comma → prefixed with "'" and wrapped in quotes.
    const csv = toSessionsCsv([s({ title: "@cmd,tail" })]);
    const row = csv.split("\n")[1];
    expect(row.startsWith('"\'@cmd,tail",')).toBe(true);
  });

  it("guards a leading line feed that spreadsheets strip before evaluating", () => {
    // Excel/Sheets drop a leading "\n" before parsing, exposing the "=" as a
    // formula — so the field must be prefixed with "'". The "\n" also forces
    // RFC-4180 quoting, giving a wrapped "'\n=SUM(A1)".
    const csv = toSessionsCsv([s({ title: "\n=SUM(A1)" })]);
    expect(csv.includes("\"'\n=SUM(A1)\"")).toBe(true);
  });

  it("returns just the header for an empty list", () => {
    expect(toSessionsCsv([])).toBe(
      "title,agent,model,project,started_at,ended_at,messages,user_messages,output_tokens,pinned",
    );
  });
});
