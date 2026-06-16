import { beforeEach, describe, expect, it } from "vitest";
import { useTabsStore, type TerminalTab } from "./tabsStore";
import { leafIds } from "@/modules/terminal/lib/terminalLayout";

function reset() {
  useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
}

function activeTerminal(): TerminalTab {
  const s = useTabsStore.getState();
  const tab = s.tabs.find((t) => t.id === s.activeId);
  if (!tab || tab.kind !== "terminal") {
    throw new Error("active tab is not a terminal");
  }
  return tab;
}

describe("tabsStore", () => {
  beforeEach(reset);

  it("opens a terminal tab with a single pane and activates it", () => {
    const id = useTabsStore.getState().newTerminalTab();
    expect(useTabsStore.getState().activeId).toBe(id);
    const tab = activeTerminal();
    expect(tab.kind).toBe("terminal");
    expect(leafIds(tab.paneTree)).toHaveLength(1);
  });

  it("opens an editor tab named from the file, deduping by path", () => {
    const first = useTabsStore.getState().openEditorTab("/a/b.ts");
    useTabsStore.getState().newTerminalTab();
    const again = useTabsStore.getState().openEditorTab("/a/b.ts");
    expect(again).toBe(first);
    const tabs = useTabsStore.getState().tabs;
    expect(tabs.filter((t) => t.kind === "editor")).toHaveLength(1);
    expect(tabs.find((t) => t.id === first)?.title).toBe("b.ts");
  });

  it("splits the active terminal tab's pane", () => {
    useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().splitActivePane("row");
    expect(leafIds(activeTerminal().paneTree)).toHaveLength(2);
  });

  it("does not split when the active tab is an editor", () => {
    useTabsStore.getState().openEditorTab("/a/b.ts");
    useTabsStore.getState().splitActivePane("row");
    const tabs = useTabsStore.getState().tabs;
    expect(tabs.every((t) => t.kind === "editor")).toBe(true);
  });

  it("closing the last pane closes the whole terminal tab", () => {
    const id = useTabsStore.getState().newTerminalTab();
    const leafId = activeTerminal().activeLeafId;
    useTabsStore.getState().closePane(id, leafId);
    expect(useTabsStore.getState().tabs.find((t) => t.id === id)).toBeUndefined();
  });

  it("closing one pane of a split keeps the tab and collapses the tree", () => {
    const id = useTabsStore.getState().newTerminalTab();
    const firstLeaf = activeTerminal().activeLeafId;
    useTabsStore.getState().splitActivePane("col");
    useTabsStore.getState().closePane(id, activeTerminal().activeLeafId);
    const tab = activeTerminal();
    expect(leafIds(tab.paneTree)).toEqual([firstLeaf]);
  });

  it("activates a neighbour when the active tab closes", () => {
    const a = useTabsStore.getState().newTerminalTab();
    const b = useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().closeTab(b);
    expect(useTabsStore.getState().activeId).toBe(a);
  });

  it("creates a default space for the first tab", () => {
    useTabsStore.getState().newTerminalTab();
    const s = useTabsStore.getState();
    expect(s.spaces).toHaveLength(1);
    expect(s.tabs[0].spaceId).toBe(s.activeSpaceId);
  });

  it("names a terminal tab after its folder", () => {
    useTabsStore.getState().newTerminalTab("/Users/muki/Documents/proj");
    expect(useTabsStore.getState().tabs[0].title).toBe("proj");
  });

  it("keeps tabs in separate spaces and switches between them", () => {
    const first = useTabsStore.getState().newTerminalTab();
    const firstSpace = useTabsStore.getState().activeSpaceId;
    const secondSpace = useTabsStore.getState().newSpace();
    expect(useTabsStore.getState().activeId).toBeNull();
    const second = useTabsStore.getState().newTerminalTab();
    expect(useTabsStore.getState().tabs.find((t) => t.id === second)?.spaceId).toBe(
      secondSpace,
    );

    useTabsStore.getState().setActiveSpace(firstSpace!);
    expect(useTabsStore.getState().activeSpaceId).toBe(firstSpace);
    expect(useTabsStore.getState().activeId).toBe(first);
  });

  it("activating a tab also activates its space", () => {
    const first = useTabsStore.getState().newTerminalTab();
    const firstSpace = useTabsStore.getState().activeSpaceId;
    useTabsStore.getState().newSpace();
    useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().setActive(first);
    expect(useTabsStore.getState().activeSpaceId).toBe(firstSpace);
  });

  it("renames a space", () => {
    useTabsStore.getState().newTerminalTab();
    const space = useTabsStore.getState().activeSpaceId!;
    useTabsStore.getState().renameSpace(space, "Project A");
    expect(useTabsStore.getState().spaces.find((s) => s.id === space)?.name).toBe(
      "Project A",
    );
  });

  it("deletes a space with its tabs and falls back to another space", () => {
    useTabsStore.getState().newTerminalTab();
    const first = useTabsStore.getState().activeSpaceId!;
    const second = useTabsStore.getState().newSpace();
    useTabsStore.getState().newTerminalTab();
    useTabsStore.getState().deleteSpace(second);
    expect(useTabsStore.getState().spaces.find((s) => s.id === second)).toBeUndefined();
    expect(useTabsStore.getState().tabs.every((t) => t.spaceId !== second)).toBe(true);
    expect(useTabsStore.getState().activeSpaceId).toBe(first);
  });
});
