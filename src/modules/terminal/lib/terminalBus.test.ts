import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  focusedTerminalOps,
  readTerminalBuffer,
  registerTerminalOps,
  registerTerminalReader,
  unregisterTerminalOps,
  unregisterTerminalReader,
  type TerminalOps,
} from "./terminalBus";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf, splitLeaf } from "./terminalLayout";

describe("terminal buffer readers", () => {
  it("returns null when no reader is registered for a leaf", () => {
    expect(readTerminalBuffer("missing")).toBeNull();
  });

  it("returns the registered reader's current output", () => {
    registerTerminalReader("leaf-1", () => "hello from shell");
    expect(readTerminalBuffer("leaf-1")).toBe("hello from shell");
    unregisterTerminalReader("leaf-1");
  });

  it("stops returning output after the reader is unregistered", () => {
    registerTerminalReader("leaf-2", () => "bye");
    unregisterTerminalReader("leaf-2");
    expect(readTerminalBuffer("leaf-2")).toBeNull();
  });
});

function makeOps(): TerminalOps {
  return {
    getSelection: vi.fn(() => "sel"),
    selectAll: vi.fn(),
    clear: vi.fn(),
    openSearch: vi.fn(),
    paste: vi.fn(),
  };
}

describe("terminal ops registry", () => {
  beforeEach(() => {
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space 1" }],
      activeSpaceId: "s1",
      tabs: [
        {
          id: "a",
          spaceId: "s1",
          title: "a",
          kind: "terminal",
          paneTree: leaf("leaf-1", { kind: "terminal" }),
          activeLeafId: "leaf-1",
          paneOrder: ["leaf-1"],
        },
      ],
      activeId: "a",
    });
  });

  it("resolves ops for the focused terminal leaf", () => {
    const ops = makeOps();
    registerTerminalOps("leaf-1", ops);
    expect(focusedTerminalOps()).toBe(ops);
    unregisterTerminalOps("leaf-1");
    expect(focusedTerminalOps()).toBeNull();
  });

  it("returns null when the focused pane is not a terminal", () => {
    registerTerminalOps("leaf-1", makeOps());
    const paneTree = splitLeaf(
      leaf("leaf-1", { kind: "terminal" }),
      "leaf-1",
      "row",
      "leaf-2",
      { kind: "editor", path: "/tmp/file.ts" },
    );
    useTabsStore.setState({
      tabs: [
        {
          id: "a",
          spaceId: "s1",
          title: "a",
          kind: "terminal",
          paneTree,
          activeLeafId: "leaf-2",
          paneOrder: ["leaf-1", "leaf-2"],
        },
      ],
      activeId: "a",
    });
    expect(focusedTerminalOps()).toBeNull();
    unregisterTerminalOps("leaf-1");
  });
});
