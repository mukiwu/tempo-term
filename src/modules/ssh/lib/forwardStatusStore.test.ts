import { describe, expect, it, beforeEach } from "vitest";
import { useForwardStatusStore } from "./forwardStatusStore";

describe("forwardStatusStore", () => {
  beforeEach(() => useForwardStatusStore.setState({ statuses: {} }));

  it("applies and reads a status", () => {
    useForwardStatusStore.getState().applyStatus({ sessionId: 1, forwardId: "f1", state: "active" });
    expect(useForwardStatusStore.getState().getStatus(1, "f1")?.state).toBe("active");
  });

  it("overwrites the same forward and keeps an error", () => {
    const s = useForwardStatusStore.getState();
    s.applyStatus({ sessionId: 1, forwardId: "f1", state: "starting" });
    s.applyStatus({ sessionId: 1, forwardId: "f1", state: "failed", error: "address in use" });
    expect(s.getStatus(1, "f1")).toMatchObject({ state: "failed", error: "address in use" });
  });

  it("clears all statuses for a session", () => {
    const s = useForwardStatusStore.getState();
    s.applyStatus({ sessionId: 1, forwardId: "f1", state: "active" });
    s.applyStatus({ sessionId: 2, forwardId: "f2", state: "active" });
    s.clearSession(1);
    expect(s.getStatus(1, "f1")).toBeUndefined();
    expect(s.getStatus(2, "f2")?.state).toBe("active");
  });
});
