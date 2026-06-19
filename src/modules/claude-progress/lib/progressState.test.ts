import { describe, expect, it } from "vitest";
import { emptyProgressState, reduceProgress } from "./progressState";

describe("reduceProgress", () => {
  it("adds a started tool to the running list", () => {
    const state = reduceProgress(emptyProgressState(), {
      kind: "tool:start",
      id: "t1",
      name: "Bash",
    });

    expect(state.runningTools).toEqual([{ id: "t1", name: "Bash" }]);
  });

  it("removes a tool from the running list when it ends", () => {
    let state = reduceProgress(emptyProgressState(), {
      kind: "tool:start",
      id: "t1",
      name: "Bash",
    });
    state = reduceProgress(state, { kind: "tool:start", id: "t2", name: "Read" });
    state = reduceProgress(state, { kind: "tool:end", id: "t1", name: "Bash", ok: true });

    expect(state.runningTools).toEqual([{ id: "t2", name: "Read" }]);
  });

  it("adds a started subagent as running", () => {
    const state = reduceProgress(emptyProgressState(), {
      kind: "subagent:start",
      id: "a1",
      agentType: "explorer",
      description: "查東西",
    });

    expect(state.subagents).toEqual([
      { id: "a1", agentType: "explorer", description: "查東西", status: "running" },
    ]);
  });

  it("marks a subagent done with stats when it finishes", () => {
    let state = reduceProgress(emptyProgressState(), {
      kind: "subagent:start",
      id: "a1",
      agentType: "explorer",
      description: "查東西",
    });
    state = reduceProgress(state, {
      kind: "subagent:end",
      id: "a1",
      agentType: "explorer",
      ok: true,
      durationMs: 1000,
      tokens: 500,
      toolUseCount: 3,
    });

    expect(state.subagents).toEqual([
      {
        id: "a1",
        agentType: "explorer",
        description: "查東西",
        status: "done",
        durationMs: 1000,
        tokens: 500,
        toolUseCount: 3,
      },
    ]);
  });

  it("replaces the todo list on each todo event", () => {
    let state = reduceProgress(emptyProgressState(), {
      kind: "todo",
      items: [{ text: "a", status: "pending" }],
    });
    state = reduceProgress(state, {
      kind: "todo",
      items: [
        { text: "a", status: "completed" },
        { text: "b", status: "in_progress" },
      ],
    });

    expect(state.todos).toEqual([
      { text: "a", status: "completed" },
      { text: "b", status: "in_progress" },
    ]);
  });

  it("sets idle on an idle event and clears it on the next activity", () => {
    let state = reduceProgress(emptyProgressState(), { kind: "idle" });
    expect(state.idle).toBe(true);

    state = reduceProgress(state, { kind: "tool:start", id: "t1", name: "Bash" });
    expect(state.idle).toBe(false);
  });
});
