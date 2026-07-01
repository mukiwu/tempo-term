import { describe, expect, it } from "vitest";
import { consumeSshDragClick, isOverTabBar, useSshDragStore } from "./sshDrag";

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

describe("tab-bar drop priority", () => {
  it("isOverTabBar resolves true when the element is inside a data-tab-bar container", () => {
    const outer = document.createElement("div");
    outer.dataset.tabBar = "";
    const inner = document.createElement("div");
    outer.appendChild(inner);
    expect(isOverTabBar(inner)).toBe(true);
  });
});

describe("useSshDragStore blockedConnectionId", () => {
  it("starts null and clearBlockedConnectionId resets it", () => {
    expect(useSshDragStore.getState().blockedConnectionId).toBeNull();
    useSshDragStore.setState({ blockedConnectionId: "conn-1" });
    useSshDragStore.getState().clearBlockedConnectionId();
    expect(useSshDragStore.getState().blockedConnectionId).toBeNull();
  });
});
