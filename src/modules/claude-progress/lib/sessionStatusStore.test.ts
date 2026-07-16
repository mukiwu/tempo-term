import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStatusStore, aggregateSessionStatus } from "./sessionStatusStore";

beforeEach(() => useSessionStatusStore.setState({ statuses: {}, agents: {} }));

describe("sessionStatusStore", () => {
  it("sets and overwrites a leaf's status", () => {
    useSessionStatusStore.getState().setStatus("leaf-1", "active");
    expect(useSessionStatusStore.getState().statuses["leaf-1"]).toBe("active");
    useSessionStatusStore.getState().setStatus("leaf-1", "idle");
    expect(useSessionStatusStore.getState().statuses["leaf-1"]).toBe("idle");
  });

  it("clears a leaf", () => {
    useSessionStatusStore.getState().setStatus("leaf-1", "active");
    useSessionStatusStore.getState().clear("leaf-1");
    expect(useSessionStatusStore.getState().statuses["leaf-1"]).toBeUndefined();
  });

  describe("aggregateSessionStatus", () => {
    it("returns null when nothing is tracked", () => {
      expect(aggregateSessionStatus({})).toBeNull();
    });

    it("picks the most urgent status across leaves", () => {
      expect(aggregateSessionStatus({ a: "active", b: "waiting-approval" })).toBe("waiting-approval");
      expect(aggregateSessionStatus({ a: "thinking", b: "active" })).toBe("active");
      expect(aggregateSessionStatus({ a: "idle", b: "thinking" })).toBe("thinking");
      expect(aggregateSessionStatus({ a: "idle" })).toBe("idle");
    });
  });

  it("clearing an unknown leaf is a no-op", () => {
    const before = useSessionStatusStore.getState().statuses;
    useSessionStatusStore.getState().clear("missing");
    expect(useSessionStatusStore.getState().statuses).toBe(before);
  });
});

describe("sessionStatusStore agents", () => {
  it("records the agent running in a leaf", () => {
    useSessionStatusStore.getState().setAgent("leaf-1", "codex");
    expect(useSessionStatusStore.getState().agents["leaf-1"]).toBe("codex");
  });

  it("clears a leaf's status and agent together when the session ends", () => {
    const store = useSessionStatusStore.getState();
    store.setStatus("leaf-1", "thinking");
    store.setAgent("leaf-1", "claude");

    store.clear("leaf-1");

    const state = useSessionStatusStore.getState();
    expect(state.statuses["leaf-1"]).toBeUndefined();
    expect(state.agents["leaf-1"]).toBeUndefined();
  });
});
