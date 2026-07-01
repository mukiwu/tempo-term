import { describe, expect, it } from "vitest";
import { consumeSshDragClick, useSshDragStore } from "./sshDrag";

describe("useSshDragStore", () => {
  it("starts with paneHover and pendingPaneDrop both null", () => {
    expect(useSshDragStore.getState().paneHover).toBeNull();
    expect(useSshDragStore.getState().pendingPaneDrop).toBeNull();
  });

  it("clearPendingPaneDrop resets pendingPaneDrop to null", () => {
    useSshDragStore.setState({
      pendingPaneDrop: { leafId: "l1", connectionId: "c1", connectionName: "Prod", xPct: 50, yPct: 50 },
    });
    useSshDragStore.getState().clearPendingPaneDrop();
    expect(useSshDragStore.getState().pendingPaneDrop).toBeNull();
  });
});

describe("consumeSshDragClick", () => {
  it("is false when no drag has just finished", () => {
    expect(consumeSshDragClick()).toBe(false);
  });
});
