import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyNoteDrop,
  beginNoteDrag,
  isOverTabBar,
  resolveNoteDrop,
  useNoteDragStore,
} from "./noteDrag";
import { useTabsStore } from "@/stores/tabsStore";

// jsdom has no PointerEvent constructor; a MouseEvent dispatched under the
// pointermove/pointerup type names reaches the same window listeners since
// beginNoteDrag's handlers only read clientX/clientY off the event.
function firePointer(type: "pointermove" | "pointerup", clientX: number, clientY: number): void {
  window.dispatchEvent(new MouseEvent(type, { clientX, clientY }));
}

describe("resolveNoteDrop", () => {
  it("resolves a folder header to a folder target carrying its path", () => {
    const div = document.createElement("div");
    div.setAttribute("data-folder-path", "/root/Ideas");
    expect(resolveNoteDrop(div)).toEqual({ kind: "folder", path: "/root/Ideas" });
  });

  it("resolves the root container to a root target carrying the root path", () => {
    const root = document.createElement("div");
    root.setAttribute("data-notes-root", "/root");
    expect(resolveNoteDrop(root)).toEqual({ kind: "root", path: "/root" });
  });

  it("prefers the folder when a note row sits inside a folder subtree", () => {
    const folderWrap = document.createElement("div");
    folderWrap.setAttribute("data-folder-path", "/root/Ideas");
    const li = document.createElement("li");
    li.setAttribute("data-note-path", "/root/Ideas/n.md");
    folderWrap.appendChild(li);
    expect(resolveNoteDrop(li)).toEqual({ kind: "folder", path: "/root/Ideas" });
  });

  it("returns null when the cursor is outside any drop zone", () => {
    expect(resolveNoteDrop(document.createElement("div"))).toBeNull();
    expect(resolveNoteDrop(null)).toBeNull();
  });
});

describe("resolveNoteDrop pane targeting", () => {
  it("resolves a pane-leaf element to a pane target", () => {
    const el = document.createElement("div");
    el.dataset.paneLeaf = "leaf-1";
    expect(resolveNoteDrop(el)).toEqual({ kind: "pane", leafId: "leaf-1" });
  });

  it("still prefers a folder over a pane when both markers are ancestors", () => {
    const outer = document.createElement("div");
    outer.dataset.paneLeaf = "leaf-1";
    const inner = document.createElement("div");
    inner.dataset.folderPath = "/notes/work";
    outer.appendChild(inner);
    expect(resolveNoteDrop(inner)).toEqual({ kind: "folder", path: "/notes/work" });
  });

  it("still returns null when nothing matches", () => {
    expect(resolveNoteDrop(document.createElement("span"))).toBeNull();
  });
});

describe("useNoteDragStore pane-drop fields", () => {
  it("starts with paneHover and pendingPaneDrop both null", () => {
    expect(useNoteDragStore.getState().paneHover).toBeNull();
    expect(useNoteDragStore.getState().pendingPaneDrop).toBeNull();
  });
});

describe("applyNoteDrop", () => {
  it("moves the note into a folder when dropped on a folder", () => {
    const moveNote = vi.fn().mockResolvedValue("/root/Ideas/n.md");
    applyNoteDrop({ kind: "folder", path: "/root/Ideas" }, "/root/n.md", { moveNote });
    expect(moveNote).toHaveBeenCalledWith("/root/n.md", "/root/Ideas");
  });

  it("moves the note to the root when dropped on the root zone", () => {
    const moveNote = vi.fn().mockResolvedValue("/root/n.md");
    applyNoteDrop({ kind: "root", path: "/root" }, "/root/Ideas/n.md", { moveNote });
    expect(moveNote).toHaveBeenCalledWith("/root/Ideas/n.md", "/root");
  });

  it("does nothing when there is no drop target", () => {
    const moveNote = vi.fn();
    applyNoteDrop(null, "/root/n.md", { moveNote });
    expect(moveNote).not.toHaveBeenCalled();
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

describe("beginNoteDrag tab-bar drop with insertion", () => {
  beforeEach(() => {
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "One" }],
      activeSpaceId: "s1",
      tabs: [],
      activeId: null,
    });
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error jsdom has no native elementFromPoint; tests assign one directly.
    delete document.elementFromPoint;
    document.body.innerHTML = "";
    useNoteDragStore.setState({ hover: null, paneHover: null, tabBarHover: null });
  });

  function setUpTabBarDom(tabIdA: string, tabIdB: string): { bar: Element } {
    document.body.innerHTML = `
      <div data-tab-bar>
        <div role="tab" data-tab-id="${tabIdA}"></div>
        <div role="tab" data-tab-id="${tabIdB}"></div>
      </div>
    `;
    const bar = document.querySelector("[data-tab-bar]")!;
    const [elA, elB] = Array.from(document.querySelectorAll('[role="tab"]'));
    vi.spyOn(elA, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
    vi.spyOn(elB, "getBoundingClientRect").mockReturnValue({ left: 100, width: 100 } as DOMRect);
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({} as DOMRect);
    return { bar };
  }

  it("reorders the newly-opened tab to land before the tab it was dropped nearest to", () => {
    const tabIdA = useTabsStore.getState().newTerminalTab();
    const tabIdB = useTabsStore.getState().newTerminalTab();
    const { bar } = setUpTabBarDom(tabIdA, tabIdB);
    document.elementFromPoint = vi.fn().mockReturnValue(bar);

    const startEvent = { clientX: 500, clientY: 10, button: 0 } as unknown as React.PointerEvent;
    beginNoteDrag("/root/n.md", "n.md", startEvent);

    firePointer("pointermove", 10, 10);
    firePointer("pointerup", 10, 10);

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(3);
    const newTab = tabs.find((t) => t.kind === "note")!;
    expect(newTab).toBeDefined();
    const indexOfNew = tabs.findIndex((t) => t.id === newTab.id);
    const indexOfA = tabs.findIndex((t) => t.id === tabIdA);
    // The new tab lands immediately before tabIdA — it takes tabIdA's former
    // slot and tabIdA shifts one place to the right.
    expect(indexOfNew).toBe(indexOfA - 1);
  });

  it("leaves the new tab at the end (no reorder) when dropped past every tab's midpoint", () => {
    const tabIdA = useTabsStore.getState().newTerminalTab();
    const tabIdB = useTabsStore.getState().newTerminalTab();
    const { bar } = setUpTabBarDom(tabIdA, tabIdB);
    document.elementFromPoint = vi.fn().mockReturnValue(bar);

    const startEvent = { clientX: 500, clientY: 10, button: 0 } as unknown as React.PointerEvent;
    beginNoteDrag("/root/n.md", "n.md", startEvent);

    firePointer("pointermove", 280, 10);
    firePointer("pointerup", 280, 10);

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(3);
    const newTab = tabs.find((t) => t.kind === "note")!;
    expect(tabs[tabs.length - 1].id).toBe(newTab.id);
  });
});
