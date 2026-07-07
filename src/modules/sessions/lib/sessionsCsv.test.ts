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

  it("returns just the header for an empty list", () => {
    expect(toSessionsCsv([])).toBe(
      "title,agent,model,project,started_at,ended_at,messages,user_messages,output_tokens,pinned",
    );
  });
});
