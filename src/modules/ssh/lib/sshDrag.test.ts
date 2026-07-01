import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginSshDrag, consumeSshDragClick, isOverTabBar, useSshDragStore } from "./sshDrag";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";

// jsdom has no PointerEvent constructor; a MouseEvent dispatched under the
// pointermove/pointerup type names reaches the same window listeners since
// beginSshDrag's handlers only read clientX/clientY off the event.
function firePointer(type: "pointermove" | "pointerup", clientX: number, clientY: number): void {
  window.dispatchEvent(new MouseEvent(type, { clientX, clientY }));
}

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

describe("beginSshDrag tab-bar drop with insertion", () => {
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
    useSshDragStore.setState({ paneHover: null, pendingPaneDrop: null, tabBarHover: null, blockedConnectionId: null });
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
    beginSshDrag("conn-1", "Prod", startEvent);

    firePointer("pointermove", 10, 10);
    firePointer("pointerup", 10, 10);

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(3);
    const newTab = tabs.find((t) => t.kind === "terminal" && t.title === "Prod")!;
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
    beginSshDrag("conn-1", "Prod", startEvent);

    firePointer("pointermove", 280, 10);
    firePointer("pointerup", 280, 10);

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(3);
    const newTab = tabs.find((t) => t.kind === "terminal" && t.title === "Prod")!;
    expect(tabs[tabs.length - 1].id).toBe(newTab.id);
  });

  it("does not reorder and sets blockedConnectionId when the connection is already open elsewhere in the space", () => {
    const existingId = useTabsStore.getState().newTerminalTab();
    useTabsStore.setState((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === existingId
          ? { ...t, paneTree: leaf(t.activeLeafId, { kind: "terminal", ssh: { connectionId: "conn-1" } }) }
          : t,
      ),
    }));
    const tabIdB = useTabsStore.getState().newTerminalTab();
    const { bar } = setUpTabBarDom(existingId, tabIdB);
    document.elementFromPoint = vi.fn().mockReturnValue(bar);

    const startEvent = { clientX: 500, clientY: 10, button: 0 } as unknown as React.PointerEvent;
    beginSshDrag("conn-1", "Prod", startEvent);

    firePointer("pointermove", 10, 10);
    firePointer("pointerup", 10, 10);

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(2);
    expect(useSshDragStore.getState().blockedConnectionId).toBe("conn-1");
  });
});
