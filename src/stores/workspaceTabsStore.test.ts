import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceTabsStore } from "./workspaceTabsStore";

function reset() {
  useWorkspaceTabsStore.setState({ tabs: [], activeTabId: null });
}

describe("workspaceTabsStore", () => {
  beforeEach(reset);

  it("opens a folder as a tab, names it from the basename and activates it", () => {
    const id = useWorkspaceTabsStore.getState().openWorkspace("/Users/muki/project");
    const { tabs, activeTabId } = useWorkspaceTabsStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ rootPath: "/Users/muki/project", name: "project" });
    expect(activeTabId).toBe(id);
  });

  it("does not open the same folder twice but re-activates the existing tab", () => {
    const first = useWorkspaceTabsStore.getState().openWorkspace("/a/proj");
    useWorkspaceTabsStore.getState().openWorkspace("/b/other");
    const again = useWorkspaceTabsStore.getState().openWorkspace("/a/proj");
    expect(again).toBe(first);
    expect(useWorkspaceTabsStore.getState().tabs).toHaveLength(2);
    expect(useWorkspaceTabsStore.getState().activeTabId).toBe(first);
  });

  it("exposes the active tab's root path", () => {
    useWorkspaceTabsStore.getState().openWorkspace("/a/proj");
    useWorkspaceTabsStore.getState().openWorkspace("/b/other");
    expect(useWorkspaceTabsStore.getState().activeRootPath()).toBe("/b/other");
  });

  it("activates a neighbour when the active tab closes", () => {
    const first = useWorkspaceTabsStore.getState().openWorkspace("/a");
    const second = useWorkspaceTabsStore.getState().openWorkspace("/b");
    useWorkspaceTabsStore.getState().closeTab(second);
    expect(useWorkspaceTabsStore.getState().activeTabId).toBe(first);
    expect(useWorkspaceTabsStore.getState().activeRootPath()).toBe("/a");
  });

  it("clears everything when the last tab closes", () => {
    const only = useWorkspaceTabsStore.getState().openWorkspace("/a");
    useWorkspaceTabsStore.getState().closeTab(only);
    expect(useWorkspaceTabsStore.getState().activeTabId).toBeNull();
    expect(useWorkspaceTabsStore.getState().activeRootPath()).toBeNull();
  });

  it("handles Windows-style and trailing-slash paths when naming", () => {
    useWorkspaceTabsStore.getState().openWorkspace("/a/proj/");
    expect(useWorkspaceTabsStore.getState().tabs[0].name).toBe("proj");
  });
});
