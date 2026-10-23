import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));

const {
  chordFromEvent,
  findChordOwner,
  formatChord,
  isReservedChord,
  matchKeybinding,
} = await import("./keybindings");

const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
  new KeyboardEvent("keydown", { code, ...mods });

describe("chordFromEvent", () => {
  it("records the primary modifier, the others and the physical key", () => {
    expect(chordFromEvent(key("KeyP", { metaKey: true, shiftKey: true }))).toBe("Mod+Shift+KeyP");
    expect(chordFromEvent(key("KeyK", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+KeyK");
  });

  it("refuses plain typing and bare modifiers, but allows function keys", () => {
    expect(chordFromEvent(key("KeyP", { shiftKey: true }))).toBeNull();
    expect(chordFromEvent(key("MetaLeft", { metaKey: true }))).toBeNull();
    expect(chordFromEvent(key("F5"))).toBe("F5");
  });
});

describe("formatChord", () => {
  it("reads in macOS glyph order", () => {
    expect(formatChord("Mod+Ctrl+Alt+Shift+KeyK")).toBe("⌃⌥⇧⌘K");
    expect(formatChord("Mod+Comma")).toBe("⌘,");
  });
});

describe("matchKeybinding", () => {
  it("does nothing without overrides", () => {
    expect(matchKeybinding(key("KeyP", { metaKey: true }), {})).toEqual({ kind: "none" });
  });

  it("runs a reassigned command and releases its old default", () => {
    const overrides = { "command-palette": "Mod+Shift+KeyK" };
    expect(matchKeybinding(key("KeyK", { metaKey: true, shiftKey: true }), overrides)).toEqual({
      kind: "run",
      id: "command-palette",
    });
    expect(matchKeybinding(key("KeyP", { metaKey: true }), overrides)).toEqual({ kind: "released" });
    expect(matchKeybinding(key("KeyT", { metaKey: true }), overrides)).toEqual({ kind: "none" });
  });
});

describe("findChordOwner", () => {
  it("names the command already using a chord", () => {
    expect(findChordOwner("Mod+KeyT", {})?.id).toBe("new-terminal-tab");
    expect(findChordOwner("Mod+KeyT", {}, "new-terminal-tab")).toBeUndefined();
    expect(findChordOwner("Mod+KeyT", { "new-terminal-tab": "Mod+KeyY" })).toBeUndefined();
  });
});

describe("isReservedChord", () => {
  it("keeps system, edit, tab and panel keys out of reach", () => {
    for (const chord of ["Mod+KeyQ", "Mod+KeyC", "Mod+KeyS", "Mod+Digit3", "Alt+Digit2"]) {
      expect(isReservedChord(chord)).toBe(true);
    }
    expect(isReservedChord("Mod+Shift+KeyY")).toBe(false);
  });

  it("refuses arrows and Enter, which the native menu cannot show", () => {
    expect(chordFromEvent(key("ArrowUp", { metaKey: true }))).toBeNull();
    expect(chordFromEvent(key("Enter", { metaKey: true }))).toBeNull();
  });
});
