import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStatusStore } from "./sessionStatusStore";

beforeEach(() =>
  useSessionStatusStore.setState({
    statuses: {},
    agents: {},
    sessionIds: {},
    statusEpochs: {},
  }),
);

describe("sessionStatusStore", () => {
  it("sets and overwrites a leaf's status", () => {
    useSessionStatusStore.getState().setStatus("leaf-1", "active");
    expect(useSessionStatusStore.getState().statuses["leaf-1"]).toBe("active");
    useSessionStatusStore.getState().setStatus("leaf-1", "idle");
    expect(useSessionStatusStore.getState().statuses["leaf-1"]).toBe("idle");
  });

  it("bumps the status epoch only on title-relevant transitions", () => {
    const store = useSessionStatusStore.getState();
    // Entering thinking (first prompt) and idle (turn done) can expose a new
    // transcript title; the active/waiting-approval churn between tool calls
    // cannot, so it must not trigger title refetches.
    store.setStatus("leaf-1", "thinking");
    expect(useSessionStatusStore.getState().statusEpochs["leaf-1"]).toBe(1);

    store.setStatus("leaf-1", "active");
    store.setStatus("leaf-1", "waiting-approval");
    store.setStatus("leaf-1", "active");
    expect(useSessionStatusStore.getState().statusEpochs["leaf-1"]).toBe(1);

    const epochs = useSessionStatusStore.getState().statusEpochs;
    store.setStatus("leaf-1", "active");
    expect(useSessionStatusStore.getState().statusEpochs).toBe(epochs);

    store.setStatus("leaf-1", "idle");
    expect(useSessionStatusStore.getState().statusEpochs["leaf-1"]).toBe(2);
  });

  it("records a session id and treats setting the same id as a no-op", () => {
    const store = useSessionStatusStore.getState();
    store.setSessionId("leaf-1", "session-a");
    const sessionIds = useSessionStatusStore.getState().sessionIds;

    store.setSessionId("leaf-1", "session-a");

    expect(useSessionStatusStore.getState().sessionIds).toBe(sessionIds);
    expect(useSessionStatusStore.getState().sessionIds["leaf-1"]).toBe("session-a");
  });

  it("clears a leaf", () => {
    useSessionStatusStore.getState().setStatus("leaf-1", "active");
    useSessionStatusStore.getState().clear("leaf-1");
    expect(useSessionStatusStore.getState().statuses["leaf-1"]).toBeUndefined();
  });

  it("clearing an unknown leaf is a no-op", () => {
    const before = useSessionStatusStore.getState();
    useSessionStatusStore.getState().clear("missing");
    expect(useSessionStatusStore.getState()).toBe(before);
  });
});

describe("sessionStatusStore agents", () => {
  it("records the agent running in a leaf", () => {
    useSessionStatusStore.getState().setAgent("leaf-1", "codex");
    expect(useSessionStatusStore.getState().agents["leaf-1"]).toBe("codex");
  });

  it("clears all of a leaf's session state when the session ends", () => {
    const store = useSessionStatusStore.getState();
    store.setStatus("leaf-1", "thinking");
    store.setAgent("leaf-1", "claude");
    store.setSessionId("leaf-1", "session-a");

    store.clear("leaf-1");

    const state = useSessionStatusStore.getState();
    expect(state.statuses["leaf-1"]).toBeUndefined();
    expect(state.agents["leaf-1"]).toBeUndefined();
    expect(state.sessionIds["leaf-1"]).toBeUndefined();
    // The status epoch goes too: title freshness compares fingerprints for
    // equality, so removal is just one more fingerprint change — and keeping
    // it would leak one entry per leaf ever seen.
    expect(state.statusEpochs["leaf-1"]).toBeUndefined();
  });
});
