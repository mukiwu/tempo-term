/**
 * Normalizes raw Claude Code transcript JSONL lines into a clean stream of
 * progress events that a UI can render. One raw line in, zero or more events
 * out. The normalizer keeps internal state so it can pair related lines (e.g. a
 * tool call with its later result), but callers only ever see the events.
 */

export interface TodoItem {
  text: string;
  status: string;
}

export type ProgressEvent =
  | { kind: "tool:start"; id: string; name: string }
  | { kind: "tool:end"; id: string; name: string; ok: boolean }
  | { kind: "subagent:start"; id: string; agentType: string; description: string }
  | {
      kind: "subagent:end";
      id: string;
      agentType: string;
      ok: boolean;
      durationMs: number;
      tokens: number;
      toolUseCount: number;
    }
  | { kind: "todo"; items: TodoItem[] }
  | { kind: "idle" };

interface RawTodo {
  content?: string;
  status?: string;
}

interface RawContentItem {
  type?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  is_error?: boolean;
  input?: {
    description?: string;
    subagent_type?: string;
    todos?: RawTodo[];
  };
}

interface RawToolUseResult {
  agentType?: string;
  status?: string;
  totalDurationMs?: number;
  totalTokens?: number;
  totalToolUseCount?: number;
}

interface RawLine {
  type?: string;
  subtype?: string;
  message?: { content?: RawContentItem[] };
  toolUseResult?: RawToolUseResult | null;
}

export interface Normalizer {
  push(rawLine: string): ProgressEvent[];
}

export function createNormalizer(): Normalizer {
  // tool_use id -> tool name, so a later tool_result can report which tool ended.
  const toolNames = new Map<string, string>();

  return {
    push(rawLine: string): ProgressEvent[] {
      let record: RawLine;
      try {
        record = JSON.parse(rawLine) as RawLine;
      } catch {
        // Watcher tails may hand us a half-written or empty line; skip it.
        return [];
      }
      const events: ProgressEvent[] = [];

      if (record.type === "system") {
        if (record.subtype === "stop_hook_summary") {
          events.push({ kind: "idle" });
        }
        return events;
      }

      const content = record.message?.content;
      if (!content) {
        return events;
      }

      if (record.type === "assistant") {
        for (const item of content) {
          if (item.type !== "tool_use" || !item.id || !item.name) {
            continue;
          }
          if (item.name === "Agent") {
            events.push({
              kind: "subagent:start",
              id: item.id,
              agentType: item.input?.subagent_type ?? "",
              description: item.input?.description ?? "",
            });
          } else if (item.name === "TodoWrite") {
            events.push({
              kind: "todo",
              items: (item.input?.todos ?? []).map((todo) => ({
                text: todo.content ?? "",
                status: todo.status ?? "",
              })),
            });
          } else {
            toolNames.set(item.id, item.name);
            events.push({ kind: "tool:start", id: item.id, name: item.name });
          }
        }
      } else if (record.type === "user") {
        const result = record.toolUseResult;
        for (const item of content) {
          if (item.type !== "tool_result" || !item.tool_use_id) {
            continue;
          }
          if (result?.agentType) {
            events.push({
              kind: "subagent:end",
              id: item.tool_use_id,
              agentType: result.agentType,
              ok: result.status === "completed",
              durationMs: result.totalDurationMs ?? 0,
              tokens: result.totalTokens ?? 0,
              toolUseCount: result.totalToolUseCount ?? 0,
            });
          } else {
            const name = toolNames.get(item.tool_use_id) ?? "";
            toolNames.delete(item.tool_use_id);
            events.push({
              kind: "tool:end",
              id: item.tool_use_id,
              name,
              ok: item.is_error !== true,
            });
          }
        }
      }

      return events;
    },
  };
}
