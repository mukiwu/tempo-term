import { beforeAll, describe, expect, it, vi } from "vitest";

// Mock BEFORE importing the stores so their module-level persist setup reads a
// secondary-window label and selects in-memory storage.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "win-1" }),
}));

import { TABS_STORAGE_KEY, useTabsStore } from "@/stores/tabsStore";
import { WORKSPACE_STORAGE_KEY, useWorkspaceStore } from "@/stores/workspaceStore";

beforeAll(() => localStorage.clear());

describe("content stores in a secondary window", () => {
  it("does not write tabs state to localStorage", () => {
    useTabsStore.getState().newTerminalTab("/tmp");
    expect(useTabsStore.getState().tabs.length).toBeGreaterThan(0);
    expect(localStorage.getItem(TABS_STORAGE_KEY)).toBeNull();
  });

  it("does not write workspace state to localStorage", () => {
    useWorkspaceStore.getState().setRoot("/tmp/project");
    expect(useWorkspaceStore.getState().rootPath).toBe("/tmp/project");
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
  });
});
