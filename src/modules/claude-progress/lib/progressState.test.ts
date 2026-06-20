import { describe, expect, it } from "vitest";
import { deriveStatus, emptyProgressState, MAX_ACTIVITIES, reduceProgress } from "./progressState";

describe("reduceProgress", () => {
  it("adds a started tool to activities as running", () => {
    const state = reduceProgress(emptyProgressState(), {
      kind: "tool:start",
      id: "t1",
      name: "Bash",
    });

    expect(state.activities).toEqual([{ id: "t1", name: "Bash", status: "running" }]);
  });

  it("marks a tool done on end and keeps it in activities", () => {
    let state = reduceProgress(emptyProgressState(), { kind: "tool:start", id: "t1", name: "Bash" });
    state = reduceProgress(state, { kind: "tool:start", id: "t2", name: "Read" });
    state = reduceProgress(state, { kind: "tool:end", id: "t1", name: "Bash", ok: true });

    expect(state.activities).toEqual([
      { id: "t1", name: "Bash", status: "done" },
      { id: "t2", name: "Read", status: "running" },
    ]);
  });

  it("marks a tool error when it ends with ok=false", () => {
    let state = reduceProgress(emptyProgressState(), { kind: "tool:start", id: "t1", name: "Bash" });
    state = reduceProgress(state, { kind: "tool:end", id: "t1", name: "Bash", ok: false });

    expect(state.activities).toEqual([{ id: "t1", name: "Bash", status: "error" }]);
  });

  it("ignores tool:end for an unknown id", () => {
    const start = reduceProgress(emptyProgressState(), { kind: "tool:start", id: "t1", name: "Bash" });
    const next = reduceProgress(start, { kind: "tool:end", id: "nope", name: "X", ok: true });

    expect(next).toBe(start);
  });

  it("caps activities at MAX_ACTIVITIES, dropping the oldest", () => {
    let state = emptyProgressState();
    for (let i = 0; i < MAX_ACTIVITIES + 5; i++) {
      state = reduceProgress(state, { kind: "tool:start", id: `t${i}`, name: "Bash" });
    }

    expect(state.activities).toHaveLength(MAX_ACTIVITIES);
    expect(state.activities[0].id).toBe("t5");
    expect(state.activities[MAX_ACTIVITIES - 1].id).toBe(`t${MAX_ACTIVITIES + 4}`);
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

  it("returns the same state reference when a todo update changes nothing", () => {
    const state = reduceProgress(emptyProgressState(), {
      kind: "todo",
      items: [
        { text: "a", status: "in_progress" },
        { text: "b", status: "pending" },
      ],
    });

    const next = reduceProgress(state, {
      kind: "todo",
      items: [
        { text: "a", status: "in_progress" },
        { text: "b", status: "pending" },
      ],
    });

    expect(next).toBe(state);
  });

  it("returns the same state reference when an idle event arrives while already idle", () => {
    const state = reduceProgress(emptyProgressState(), { kind: "idle" });

    const next = reduceProgress(state, { kind: "idle" });

    expect(next).toBe(state);
  });

  it("derives active when a tool or subagent is running", () => {
    const state = reduceProgress(emptyProgressState(), { kind: "tool:start", id: "t1", name: "Bash" });
    expect(deriveStatus(state)).toBe("active");
  });

  it("derives idle (waiting for input) when a pending tool is an interactive prompt", () => {
    // AskUserQuestion / ExitPlanMode block on the user, so a session paused on one
    // is waiting for input, not actively working.
    const asking = reduceProgress(emptyProgressState(), {
      kind: "tool:start",
      id: "q1",
      name: "AskUserQuestion",
    });
    expect(deriveStatus(asking)).toBe("idle");

    const planning = reduceProgress(emptyProgressState(), {
      kind: "tool:start",
      id: "p1",
      name: "ExitPlanMode",
    });
    expect(deriveStatus(planning)).toBe("idle");
  });

  it("derives active again once the interactive prompt is answered", () => {
    let state = reduceProgress(emptyProgressState(), {
      kind: "tool:start",
      id: "q1",
      name: "AskUserQuestion",
    });
    state = reduceProgress(state, { kind: "tool:start", id: "t2", name: "Bash" });
    state = reduceProgress(state, { kind: "tool:end", id: "q1", name: "AskUserQuestion", ok: true });
    // The prompt is answered (done) but Bash is still running, so back to active.
    expect(deriveStatus(state)).toBe("active");
  });

  it("derives idle when idle and nothing is running", () => {
    let state = reduceProgress(emptyProgressState(), { kind: "tool:start", id: "t1", name: "Bash" });
    state = reduceProgress(state, { kind: "tool:end", id: "t1", name: "Bash", ok: true });
    state = reduceProgress(state, { kind: "idle" });
    expect(deriveStatus(state)).toBe("idle");
  });

  it("derives thinking when there is history but nothing running and not idle", () => {
    let state = reduceProgress(emptyProgressState(), { kind: "tool:start", id: "t1", name: "Bash" });
    state = reduceProgress(state, { kind: "tool:end", id: "t1", name: "Bash", ok: true });
    expect(deriveStatus(state)).toBe("thinking");
  });
});
