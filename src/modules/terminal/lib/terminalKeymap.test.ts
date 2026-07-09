import { describe, expect, it } from "vitest";
import {
  terminalKeySequence,
  isAppShortcut,
  type NavKeyEvent,
  type AppShortcutEvent,
} from "./terminalKeymap";

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

const appBase: AppShortcutEvent = {
  code: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
};
const win = (e: Partial<AppShortcutEvent>) => isAppShortcut({ ...appBase, ...e }, true);
const notWin = (e: Partial<AppShortcutEvent>) => isAppShortcut({ ...appBase, ...e }, false);

describe("isAppShortcut", () => {
  it("treats Cmd/Ctrl+digit as tab-switch and Alt+digit as sidebar on every platform", () => {
    expect(notWin({ code: "Digit3", metaKey: true })).toBe(true);
    expect(win({ code: "Digit3", ctrlKey: true })).toBe(true);
    expect(notWin({ code: "Digit3", altKey: true })).toBe(true);
    // Alt+Ctrl+digit is neither.
    expect(win({ code: "Digit3", altKey: true, ctrlKey: true })).toBe(false);
  });

  it("treats zoom keys and Cmd/Ctrl+backtick as app shortcuts on every platform", () => {
    for (const code of ["Equal", "Minus", "Digit0", "Backquote"]) {
      expect(notWin({ code, metaKey: true })).toBe(true);
      expect(win({ code, ctrlKey: true })).toBe(true);
    }
  });

  it("routes the Windows Ctrl+letter shortcuts to the app so the shell can't eat them", () => {
    // These collide with terminal control codes (Ctrl+T=^T, Ctrl+D=EOF, ...);
    // on Windows the app must win. Shift variants of W/T/D are valid too.
    for (const code of ["KeyW", "KeyT", "KeyD"]) {
      expect(win({ code, ctrlKey: true })).toBe(true);
      expect(win({ code, ctrlKey: true, shiftKey: true })).toBe(true);
    }
    for (const code of ["KeyP", "KeyB", "KeyN", "Comma"]) {
      expect(win({ code, ctrlKey: true })).toBe(true);
      // No Shift variant for these — Ctrl+Shift+P etc. stay with the terminal.
      expect(win({ code, ctrlKey: true, shiftKey: true })).toBe(false);
    }
  });

  it("does NOT claim those Ctrl+letter keys off Windows (macOS uses Cmd, no collision)", () => {
    for (const code of ["KeyW", "KeyT", "KeyD", "KeyP", "KeyB", "KeyN", "Comma"]) {
      expect(notWin({ code, ctrlKey: true })).toBe(false);
    }
  });

  it("leaves Ctrl+L to the terminal (clear-screen) on Windows", () => {
    expect(win({ code: "KeyL", ctrlKey: true })).toBe(false);
  });

  it("does NOT treat Windows-key combos as app shortcuts (metaKey is the Win key)", () => {
    // Win+W / Win+T / Win+3 must fall through to the OS, not be claimed by the app.
    expect(win({ code: "KeyW", metaKey: true })).toBe(false);
    expect(win({ code: "KeyT", metaKey: true })).toBe(false);
    expect(win({ code: "Digit3", metaKey: true })).toBe(false);
    expect(win({ code: "Backquote", metaKey: true })).toBe(false);
    // Even Ctrl+Win+W is rejected (Win held).
    expect(win({ code: "KeyW", ctrlKey: true, metaKey: true })).toBe(false);
  });
});
