import { describe, expect, it } from "vitest";
import { terminalKeySequence, type NavKeyEvent } from "./terminalKeymap";

const base: NavKeyEvent = {
  key: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
};

const mac = (e: Partial<NavKeyEvent>) => terminalKeySequence({ ...base, ...e }, true);
const other = (e: Partial<NavKeyEvent>) => terminalKeySequence({ ...base, ...e }, false);

describe("terminalKeySequence", () => {
  it("sends ESC CR for Shift+Enter (newline without submit)", () => {
    expect(mac({ key: "Enter", shiftKey: true })).toBe("\x1b\r");
  });

  it("maps Cmd+K to kill-to-end-of-line on macOS", () => {
    expect(mac({ key: "k", metaKey: true })).toBe("\x0b");
    expect(other({ key: "k", metaKey: true })).toBeNull();
  });

  it("maps Cmd+Left/Right to line start/end on macOS", () => {
    expect(mac({ key: "ArrowLeft", metaKey: true })).toBe("\x01");
    expect(mac({ key: "ArrowRight", metaKey: true })).toBe("\x05");
  });

  it("maps Alt+Left/Right to word back/forward", () => {
    expect(mac({ key: "ArrowLeft", altKey: true })).toBe("\x1bb");
    expect(mac({ key: "ArrowRight", altKey: true })).toBe("\x1bf");
  });

  it("maps Cmd+Backspace to delete-to-line-start and Option+Backspace to delete-word on macOS", () => {
    expect(mac({ key: "Backspace", metaKey: true })).toBe("\x15");
    expect(mac({ key: "Backspace", altKey: true })).toBe("\x17");
  });

  it("maps Ctrl+Backspace to delete-word on other platforms", () => {
    expect(other({ key: "Backspace", ctrlKey: true })).toBe("\x17");
  });

  it("leaves Ctrl+Arrow and plain keys to the shell", () => {
    expect(mac({ key: "ArrowLeft", ctrlKey: true })).toBeNull();
    expect(mac({ key: "ArrowLeft" })).toBeNull();
    expect(mac({ key: "Enter" })).toBeNull();
  });
});
