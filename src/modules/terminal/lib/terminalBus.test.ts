import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  focusedTerminalOps,
  pasteIntoActiveTerminal,
  readTerminalBuffer,
  registerTerminal,
  registerTerminalOps,
  registerTerminalReader,
  unregisterTerminal,
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

describe("pasteIntoActiveTerminal", () => {
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

  it("pastes through the pane's xterm paste so bracketed paste applies", () => {
    const ops = makeOps();
    registerTerminalOps("leaf-1", ops);
    pasteIntoActiveTerminal("echo hi");
    expect(ops.paste).toHaveBeenCalledWith("echo hi");
    unregisterTerminalOps("leaf-1");
  });

  it("strips trailing newlines so a shell never auto-executes the paste", () => {
    const ops = makeOps();
    registerTerminalOps("leaf-1", ops);
    pasteIntoActiveTerminal("echo hi\n");
    expect(ops.paste).toHaveBeenCalledWith("echo hi");
    unregisterTerminalOps("leaf-1");
  });

  it("keeps interior newlines of a multi-line prompt", () => {
    const ops = makeOps();
    registerTerminalOps("leaf-1", ops);
    pasteIntoActiveTerminal("line one\nline two\r\n");
    expect(ops.paste).toHaveBeenCalledWith("line one\nline two");
    unregisterTerminalOps("leaf-1");
  });

  it("falls back to a raw write when the pane has no ops registered", () => {
    const write = vi.fn();
    registerTerminal("leaf-1", write);
    pasteIntoActiveTerminal("echo hi");
    expect(write).toHaveBeenCalledWith("echo hi");
    unregisterTerminal("leaf-1");
  });

  it("opens a new terminal tab when none exists", () => {
    useTabsStore.setState({ tabs: [], activeId: null });
    pasteIntoActiveTerminal("echo hi");
    const state = useTabsStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].kind).toBe("terminal");
  });
});
