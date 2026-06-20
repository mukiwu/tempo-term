import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./uiStore";

beforeEach(() => useUiStore.setState({ sidebarView: "explorer", sidebarVisible: false }));

describe("uiStore workspaces view", () => {
  it("selects the workspaces view and reveals the sidebar", () => {
    useUiStore.getState().selectSidebar("workspaces");
    expect(useUiStore.getState().sidebarView).toBe("workspaces");
    expect(useUiStore.getState().sidebarVisible).toBe(true);
  });
});
