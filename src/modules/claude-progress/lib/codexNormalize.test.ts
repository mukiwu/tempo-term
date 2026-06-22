import { describe, it, expect } from "vitest";
import { createCodexNormalizer } from "./codexNormalize";

describe("createCodexNormalizer", () => {
  it("pairs a function_call with its function_call_output by call_id", () => {
    const n = createCodexNormalizer();
    const start = n.push(
      JSON.stringify({
        type: "response_item",
        payload: { type: "function_call", name: "exec_command", call_id: "c1", arguments: "{}" },
      }),
    );
    expect(start).toEqual([{ kind: "tool:start", id: "c1", name: "Shell" }]);

    const end = n.push(
      JSON.stringify({
        type: "response_item",
        payload: { type: "function_call_output", call_id: "c1", output: "Process exited with code 0" },
      }),
    );
    expect(end).toEqual([{ kind: "tool:end", id: "c1", name: "Shell", ok: true }]);
  });

  it("maps update_plan to a todo event", () => {
    const n = createCodexNormalizer();
    const events = n.push(
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call",
          name: "update_plan",
          call_id: "p1",
          arguments: JSON.stringify({
            plan: [
              { step: "Audit", status: "in_progress" },
              { step: "Implement", status: "pending" },
            ],
          }),
        },
      }),
    );
    expect(events).toEqual([
      { kind: "todo", items: [
        { text: "Audit", status: "in_progress" },
        { text: "Implement", status: "pending" },
      ] },
    ]);
  });

  it("maps custom_tool_call update_plan to a todo event", () => {
    const n = createCodexNormalizer();
    const events = n.push(
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "update_plan",
          call_id: "p2",
          input: JSON.stringify({ plan: [{ step: "Deploy", status: "pending" }] }),
        },
      }),
    );
    expect(events).toEqual([{ kind: "todo", items: [{ text: "Deploy", status: "pending" }] }]);
  });

  it("treats apply_patch custom_tool_call as a tool with a friendly name", () => {
    const n = createCodexNormalizer();
    const start = n.push(
      JSON.stringify({
        type: "response_item",
        payload: { type: "custom_tool_call", name: "apply_patch", call_id: "a1", status: "completed", input: "*** Begin Patch" },
      }),
    );
    expect(start).toEqual([{ kind: "tool:start", id: "a1", name: "Edit" }]);
    const end = n.push(
      JSON.stringify({
        type: "response_item",
        payload: { type: "custom_tool_call_output", call_id: "a1", status: "completed" },
      }),
    );
    expect(end).toEqual([{ kind: "tool:end", id: "a1", name: "Edit", ok: true }]);
  });

  it("emits idle on task_complete", () => {
    const n = createCodexNormalizer();
    expect(
      n.push(JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } })),
    ).toEqual([{ kind: "idle" }]);
  });

  it("ignores reasoning, token_count, messages, and malformed lines", () => {
    const n = createCodexNormalizer();
    expect(n.push(JSON.stringify({ type: "response_item", payload: { type: "reasoning" } }))).toEqual([]);
    expect(n.push(JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }))).toEqual([]);
    expect(n.push("not json")).toEqual([]);
    expect(n.push("")).toEqual([]);
  });

  it("does not crash on a JSON null line", () => {
    // JSON.parse("null") yields null, not a throw, so the payload access must be
    // null-safe or it would TypeError outside the parse try/catch.
    const n = createCodexNormalizer();
    expect(n.push("null")).toEqual([]);
  });

  it("tolerates a null element in an update_plan plan array", () => {
    const n = createCodexNormalizer();
    const events = n.push(
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call",
          name: "update_plan",
          call_id: "p",
          arguments: JSON.stringify({ plan: [{ step: "A", status: "x" }, null] }),
        },
      }),
    );
    expect(events).toEqual([
      { kind: "todo", items: [
        { text: "A", status: "x" },
        { text: "", status: "" },
      ] },
    ]);
  });
});
