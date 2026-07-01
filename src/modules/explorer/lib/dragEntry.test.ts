import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// jsdom has no PointerEvent constructor; a MouseEvent dispatched under the
// pointermove/pointerup type names reaches the same window listeners since
// beginEntryDrag's handlers only read clientX/clientY off the event.
function firePointer(type: "pointermove" | "pointerup", clientX: number, clientY: number): void {
  window.dispatchEvent(new MouseEvent(type, { clientX, clientY }));
}
import {
  beginEntryDrag,
  consumeDragClick,
  fileUrl,
  getDraggedEntry,
  isOverTabBar,
  markdownLink,
  pointerToPaneAreaPct,
  setDraggedEntry,
  shellQuotePath,
  useEntryDragStore,
} from "./dragEntry";
import { useTabsStore } from "@/stores/tabsStore";

describe("shellQuotePath", () => {
  it("leaves simple paths unquoted", () => {
    expect(shellQuotePath("/Users/me/proj/App.tsx")).toBe("/Users/me/proj/App.tsx");
  });

  it("quotes paths containing spaces", () => {
    expect(shellQuotePath("/Users/me/My Project/a.md")).toBe(
      "'/Users/me/My Project/a.md'",
    );
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuotePath("/a/it's/b")).toBe("'/a/it'\\''s/b'");
  });
});

describe("markdownLink", () => {
  it("builds a markdown link", () => {
    expect(markdownLink("App.tsx", "/x/App.tsx")).toBe("[App.tsx](/x/App.tsx)");
  });
});

describe("fileUrl", () => {
  it("prefixes file://", () => {
    expect(fileUrl("/x/index.html")).toBe("file:///x/index.html");
  });
});

describe("getDraggedEntry / setDraggedEntry", () => {
  it("round-trips the dragged entry and clears to null", () => {
    expect(getDraggedEntry()).toBeNull();
    const entry = { path: "/a/b.ts", name: "b.ts", isDir: false };
    setDraggedEntry(entry);
    expect(getDraggedEntry()).toEqual(entry);
    setDraggedEntry(null);
    expect(getDraggedEntry()).toBeNull();
  });
});

describe("consumeDragClick", () => {
  it("is false when no drag has just finished", () => {
    expect(consumeDragClick()).toBe(false);
  });
});

describe("pointerToPaneAreaPct", () => {
  it("converts a client point to a 0-100 percentage of the given container rect", () => {
    const containerRect = { left: 100, top: 50, width: 400, height: 200 } as DOMRect;
    expect(pointerToPaneAreaPct(containerRect, 300, 150)).toEqual({ xPct: 50, yPct: 50 });
  });

  it("clamps to 0-100 when the point is outside the container (fast pointer movement)", () => {
    const containerRect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
    expect(pointerToPaneAreaPct(containerRect, -20, 250)).toEqual({ xPct: 0, yPct: 100 });
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

  it("isOverTabBar resolves false otherwise", () => {
    expect(isOverTabBar(document.createElement("div"))).toBe(false);
  });
});

describe("beginEntryDrag tab-bar drop with insertion", () => {
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
    useEntryDragStore.setState({ entry: null, dragging: false, tabBarHover: null });
  });

  function setUpTabBarDom(tabIdA: string, tabIdB: string): { elA: Element; elB: Element; bar: Element } {
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
    return { elA, elB, bar };
  }

  it("reorders the newly-opened tab to land before the tab it was dropped nearest to", () => {
    const tabIdA = useTabsStore.getState().newTerminalTab();
    const tabIdB = useTabsStore.getState().newTerminalTab();
    const { bar } = setUpTabBarDom(tabIdA, tabIdB);
    document.elementFromPoint = vi.fn().mockReturnValue(bar);

    const startEvent = { clientX: 500, clientY: 10, button: 0 } as unknown as React.PointerEvent;
    beginEntryDrag({ path: "/new.ts", name: "new.ts", isDir: false }, startEvent);

    firePointer("pointermove", 10, 10);
    firePointer("pointerup", 10, 10);

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(3);
    const newTab = tabs.find((t) => t.kind === "editor")!;
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
    beginEntryDrag({ path: "/new.ts", name: "new.ts", isDir: false }, startEvent);

    firePointer("pointermove", 280, 10);
    firePointer("pointerup", 280, 10);

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(3);
    const newTab = tabs.find((t) => t.kind === "editor")!;
    expect(tabs[tabs.length - 1].id).toBe(newTab.id);
  });
});
