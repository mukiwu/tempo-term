import { describe, expect, it, beforeEach } from "vitest";
import { liveSessionsStore } from "./liveSessionsStore";

describe("liveSessionsStore", () => {
  beforeEach(() => {
    liveSessionsStore.setState({ sessions: {} });
  });

  it("starts empty", () => {
    expect(liveSessionsStore.getState().sessionsFor("conn-1")).toEqual([]);
  });

  it("register adds a sessionId under the given connectionId", () => {
    liveSessionsStore.getState().register("conn-1", 42);
    expect(liveSessionsStore.getState().sessionsFor("conn-1")).toEqual([42]);
  });

  it("register allows multiple sessions for the same connection", () => {
    liveSessionsStore.getState().register("conn-1", 10);
    liveSessionsStore.getState().register("conn-1", 20);
    expect(liveSessionsStore.getState().sessionsFor("conn-1")).toEqual([10, 20]);
  });

  it("register does not mix sessions across connections", () => {
    liveSessionsStore.getState().register("conn-1", 10);
    liveSessionsStore.getState().register("conn-2", 20);
    expect(liveSessionsStore.getState().sessionsFor("conn-1")).toEqual([10]);
    expect(liveSessionsStore.getState().sessionsFor("conn-2")).toEqual([20]);
  });

  it("unregister removes a sessionId from its connection", () => {
    liveSessionsStore.getState().register("conn-1", 10);
    liveSessionsStore.getState().register("conn-1", 20);
    liveSessionsStore.getState().unregister(10);
    expect(liveSessionsStore.getState().sessionsFor("conn-1")).toEqual([20]);
  });

  it("unregister removes the connectionId entry when no sessions remain", () => {
    liveSessionsStore.getState().register("conn-1", 10);
    liveSessionsStore.getState().unregister(10);
    // Key should be absent, not an empty array (keeps state clean)
    expect("conn-1" in liveSessionsStore.getState().sessions).toBe(false);
  });

  it("unregister is a no-op for an unknown sessionId", () => {
    liveSessionsStore.getState().register("conn-1", 10);
    liveSessionsStore.getState().unregister(999);
    expect(liveSessionsStore.getState().sessionsFor("conn-1")).toEqual([10]);
  });

  it("sessionsFor returns [] for an unknown connectionId", () => {
    expect(liveSessionsStore.getState().sessionsFor("unknown")).toEqual([]);
  });
});
