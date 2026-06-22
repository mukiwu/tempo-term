import type { Normalizer, ProgressEvent, TodoItem } from "./normalize";

export type AgentKind = "claude" | "codex";

interface CodexPayload {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  input?: string;
  status?: string;
}

interface CodexLine {
  type?: string;
  payload?: CodexPayload;
}

/** Codex internal tool names mapped to panel-friendly labels. Unknown names pass through. */
const FRIENDLY_TOOL_NAMES: Record<string, string> = {
  exec_command: "Shell",
  apply_patch: "Edit",
  view_image: "Read",
  write_stdin: "Input",
  web_search: "Web search",
};

function friendly(name: string): string {
  return FRIENDLY_TOOL_NAMES[name] ?? name;
}

/** Codex `update_plan` arguments: { plan: [{ step, status }] } -> TodoItem[]. */
function parsePlan(argsJson: string | undefined): TodoItem[] {
  if (!argsJson) {
    return [];
  }
  try {
    const parsed = JSON.parse(argsJson) as { plan?: ({ step?: string; status?: string } | null)[] };
    return (parsed.plan ?? []).map((s) => ({ text: s?.step ?? "", status: s?.status ?? "" }));
  } catch {
    return [];
  }
}

/** Codex outputs carry no explicit success flag; treat a present non-completed status
 * as failure, otherwise assume success. Refined later (see plan open questions). */
function isOk(payload: CodexPayload): boolean {
  if (!payload.status) {
    return true;
  }
  return payload.status === "completed" || payload.status === "success";
}

/**
 * Normalizes Codex rollout JSONL into the same ProgressEvent stream the Claude
 * normalizer emits, so the existing reducer, store, and panel render it unchanged.
 * One raw line in, zero or more events out. Stateful: pairs tool calls with their
 * outputs by call_id, like the Claude normalizer pairs tool_use ids.
 */
export function createCodexNormalizer(): Normalizer {
  const toolNames = new Map<string, string>();

  return {
    push(rawLine: string): ProgressEvent[] {
      let record: CodexLine;
      try {
        record = JSON.parse(rawLine) as CodexLine;
      } catch {
        return [];
      }
      const payload = record?.payload;
      if (!payload) {
        return [];
      }
      const events: ProgressEvent[] = [];

      if (record.type === "response_item") {
        const isCall = payload.type === "function_call" || payload.type === "custom_tool_call";
        const isOutput =
          payload.type === "function_call_output" || payload.type === "custom_tool_call_output";
        if (isCall && payload.call_id && payload.name) {
          if (payload.name === "update_plan") {
            events.push({ kind: "todo", items: parsePlan(payload.arguments ?? payload.input) });
          } else {
            toolNames.set(payload.call_id, friendly(payload.name));
            events.push({ kind: "tool:start", id: payload.call_id, name: friendly(payload.name) });
          }
        } else if (isOutput && payload.call_id) {
          const name = toolNames.get(payload.call_id) ?? "";
          toolNames.delete(payload.call_id);
          events.push({ kind: "tool:end", id: payload.call_id, name, ok: isOk(payload) });
        }
      } else if (record.type === "event_msg" && payload.type === "task_complete") {
        events.push({ kind: "idle" });
      }

      return events;
    },
  };
}
