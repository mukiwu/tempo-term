import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { PaneTabContent } from "./PaneTabContent";
import { useTabsStore } from "@/stores/tabsStore";
import { useEntryDragStore } from "@/modules/explorer/lib/dragEntry";
import { useNoteDragStore } from "@/modules/notes/lib/noteDrag";
import { useSshDragStore } from "@/modules/ssh/lib/sshDrag";
import { leaf, splitLeaf } from "./lib/terminalLayout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.name ? `${key}:${opts.name}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// TerminalView (rendered by every pane here) calls getCurrentWebview() on mount
// to listen for native OS file drags — no Tauri runtime exists in jsdom.
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

function makeSinglePaneTab() {
  const tabId = useTabsStore.getState().newTerminalTab();
  const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
  return { tabId, leafId: tab.activeLeafId };
}

describe("PaneTabContent file-drop dispatch", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    useEntryDragStore.setState({
      entry: null,
      dragging: false,
      hoverLeafId: null,
      hoverPointerPct: null,
      pendingDrop: null,
    });
  });

  it("center drop on an editor pane replaces its content (existing per-kind behavior, unchanged)", () => {
    const { tabId, leafId } = makeSinglePaneTab();
    useTabsStore.getState().setPaneContent(tabId, leafId, { kind: "editor", path: "/old.ts" });
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    render(<PaneTabContent tab={tab} />);

    act(() => {
      useEntryDragStore.setState({
        pendingDrop: {
          leafId,
          entry: { path: "/new.ts", name: "new.ts", isDir: false },
          xPct: 50,
          yPct: 50,
        },
      });
    });

    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneTree).toEqual({ kind: "leaf", id: leafId, pane: { kind: "editor", path: "/new.ts" } });
  });

  it("left-edge drop on a single-pane tab splits row with the new editor pane before the existing one", () => {
    const { tabId, leafId } = makeSinglePaneTab();
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    render(<PaneTabContent tab={tab} />);

    act(() => {
      useEntryDragStore.setState({
        pendingDrop: {
          leafId,
          entry: { path: "/new.ts", name: "new.ts", isDir: false },
          xPct: 5,
          yPct: 50,
        },
      });
    });

    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneTree.kind).toBe("split");
    if (updated.paneTree.kind === "split") {
      expect(updated.paneTree.direction).toBe("row");
      const [first, second] = updated.paneTree.children;
      expect(first.kind === "leaf" && first.pane).toEqual({ kind: "editor", path: "/new.ts" });
      expect(second.kind === "leaf" && second.id).toBe(leafId);
    }
  });

  it("outer-left drop on a 2-pane row tab wraps the whole tree instead of splitting one pane", () => {
    const { tabId, leafId } = makeSinglePaneTab();
    useTabsStore.getState().splitPaneWith(tabId, leafId, { kind: "editor", path: "/b.ts" }, "row");
    const tabBeforeDrop = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    const existingTree = tabBeforeDrop.paneTree;
    render(<PaneTabContent tab={tabBeforeDrop} />);

    act(() => {
      useEntryDragStore.setState({
        pendingDrop: {
          leafId,
          entry: { path: "/new.ts", name: "new.ts", isDir: false },
          xPct: 2,
          yPct: 50,
        },
      });
    });

    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneTree.kind).toBe("split");
    if (updated.paneTree.kind === "split") {
      expect(updated.paneTree.direction).toBe("row");
      const [first, second] = updated.paneTree.children;
      expect(first.kind === "leaf" && first.pane).toEqual({ kind: "editor", path: "/new.ts" });
      expect(second).toEqual(existingTree);
    }
  });

  it("dropping a folder at an edge falls back to center (folder exception)", () => {
    const { tabId, leafId } = makeSinglePaneTab();
    useTabsStore.getState().setPaneContent(tabId, leafId, { kind: "terminal" });
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    render(<PaneTabContent tab={tab} />);

    act(() => {
      useEntryDragStore.setState({
        pendingDrop: {
          leafId,
          entry: { path: "/somedir", name: "somedir", isDir: true },
          xPct: 5,
          yPct: 50,
        },
      });
    });

    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    // Still one leaf — no split happened — and the terminal pane's existing
    // center behavior (drop path text) ran instead.
    expect(updated.paneTree.kind).toBe("leaf");
  });

  it("shows the at-capacity InfoDialog and does not split when the tab already has 8 panes", () => {
    const { tabId, leafId } = makeSinglePaneTab();
    let tree = leaf(leafId);
    let lastId = leafId;
    for (let i = 0; i < 7; i++) {
      const nextId = `p${i}`;
      tree = splitLeaf(tree, lastId, "row", nextId);
      lastId = nextId;
    }
    useTabsStore.setState((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, paneTree: tree, paneOrder: [leafId, "p0", "p1", "p2", "p3", "p4", "p5", "p6"] }
          : t,
      ),
    }));
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    render(<PaneTabContent tab={tab} />);

    act(() => {
      useEntryDragStore.setState({
        pendingDrop: {
          leafId,
          entry: { path: "/new.ts", name: "new.ts", isDir: false },
          xPct: 5,
          yPct: 50,
        },
      });
    });

    expect(screen.getByText("paneCapacityAlert")).toBeInTheDocument();
    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneOrder).toHaveLength(8);
  });
});

describe("PaneTabContent note-drop dispatch", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    useNoteDragStore.setState({ hover: null, paneHover: null, pendingPaneDrop: null });
  });

  it("center drop always replaces the pane with the note (no per-target-kind branching)", () => {
    const { tabId, leafId } = makeSinglePaneTab();
    useTabsStore.getState().setPaneContent(tabId, leafId, { kind: "editor", path: "/old.ts" });
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    render(<PaneTabContent tab={tab} />);

    act(() => {
      useNoteDragStore.setState({
        pendingPaneDrop: { leafId, noteId: "/notes/todo.md", noteTitle: "Todo", xPct: 50, yPct: 50 },
      });
    });

    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneTree).toEqual({
      kind: "leaf",
      id: leafId,
      pane: { kind: "note", noteId: "/notes/todo.md" },
    });
  });

  it("right-edge drop splits row with the note pane after the existing one", () => {
    const { tabId, leafId } = makeSinglePaneTab();
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    render(<PaneTabContent tab={tab} />);

    act(() => {
      useNoteDragStore.setState({
        pendingPaneDrop: { leafId, noteId: "/notes/todo.md", noteTitle: "Todo", xPct: 95, yPct: 50 },
      });
    });

    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneTree.kind).toBe("split");
    if (updated.paneTree.kind === "split") {
      const second = updated.paneTree.children[1];
      expect(second.kind === "leaf" && second.pane).toEqual({ kind: "note", noteId: "/notes/todo.md" });
    }
  });
});

describe("PaneTabContent SSH-drop dispatch", () => {
  beforeEach(() => {
    useSshDragStore.setState({ paneHover: null, pendingPaneDrop: null });
  });

  it("center drop replaces the pane with the SSH terminal when not already connected", () => {
    const { tabId, leafId } = makeSinglePaneTab();
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    render(<PaneTabContent tab={tab} />);

    act(() => {
      useSshDragStore.setState({
        pendingPaneDrop: { leafId, connectionId: "conn-1", connectionName: "Prod", xPct: 50, yPct: 50 },
      });
    });

    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneTree).toEqual({
      kind: "leaf",
      id: leafId,
      pane: { kind: "terminal", ssh: { connectionId: "conn-1" } },
    });
  });

  it("blocks the drop and shows the already-connected InfoDialog when the connection is open elsewhere", () => {
    const { tabId, leafId } = makeSinglePaneTab();
    useTabsStore.getState().splitPaneWith(
      tabId,
      leafId,
      { kind: "terminal", ssh: { connectionId: "conn-1" } },
      "row",
    );
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    const untouchedTree = tab.paneTree;
    render(<PaneTabContent tab={tab} />);

    act(() => {
      useSshDragStore.setState({
        pendingPaneDrop: { leafId, connectionId: "conn-1", connectionName: "Prod", xPct: 50, yPct: 50 },
      });
    });

    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneTree).toEqual(untouchedTree);
    expect(screen.getByText("connectionsPanel.alreadyOpenAlert:Prod")).toBeInTheDocument();
  });

  it("blocks an edge-split too, not just center, when already connected", () => {
    const { tabId, leafId } = makeSinglePaneTab();
    useTabsStore.getState().splitPaneWith(
      tabId,
      leafId,
      { kind: "terminal", ssh: { connectionId: "conn-1" } },
      "row",
    );
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    const untouchedTree = tab.paneTree;
    render(<PaneTabContent tab={tab} />);

    act(() => {
      useSshDragStore.setState({
        pendingPaneDrop: { leafId, connectionId: "conn-1", connectionName: "Prod", xPct: 5, yPct: 50 },
      });
    });

    const updated = useTabsStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(updated.paneTree).toEqual(untouchedTree);
  });
});
