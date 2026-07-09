import { beforeEach, describe, expect, it, vi } from "vitest";
import { menuCopy, menuPaste, menuSelectAll } from "./editActions";

const { focusedOps, insertActive } = vi.hoisted(() => ({
  focusedOps: { value: null as unknown },
  insertActive: vi.fn(() => true),
}));
vi.mock("@/modules/terminal/lib/terminalBus", () => ({
  focusedTerminalOps: () => focusedOps.value,
  insertIntoActiveTerminal: insertActive,
}));

describe("edit actions", () => {
  beforeEach(() => {
    focusedOps.value = null;
    insertActive.mockClear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(), readText: vi.fn(async () => "clip") },
    });
    document.execCommand = vi.fn(() => true);
  });

  it("copies the terminal selection to the clipboard", async () => {
    focusedOps.value = { getSelection: () => "picked", selectAll: vi.fn(), clear: vi.fn(), openSearch: vi.fn() };
    await menuCopy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("picked");
  });

  it("falls back to execCommand copy without a terminal selection", async () => {
    await menuCopy();
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("pastes into a focused terminal via the bus", async () => {
    focusedOps.value = { getSelection: () => "", selectAll: vi.fn(), clear: vi.fn(), openSearch: vi.fn() };
    await menuPaste();
    expect(insertActive).toHaveBeenCalledWith("clip");
  });

  it("select-all targets the terminal when one is focused, else execCommand", () => {
    const selectAll = vi.fn();
    focusedOps.value = { getSelection: () => "", selectAll, clear: vi.fn(), openSearch: vi.fn() };
    menuSelectAll();
    expect(selectAll).toHaveBeenCalled();
    focusedOps.value = null;
    menuSelectAll();
    expect(document.execCommand).toHaveBeenCalledWith("selectAll");
  });
});
