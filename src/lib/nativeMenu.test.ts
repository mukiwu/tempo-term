import { describe, expect, it } from "vitest";
import { macShortcutToAccelerator } from "@/lib/nativeMenu";

describe("macShortcutToAccelerator", () => {
  it.each([
    ["⌘T", "Cmd+T"],
    ["⇧⌘T", "Shift+Cmd+T"],
    ["⌘N", "Cmd+N"],
    ["⌥1", "Alt+1"],
    ["⌥7", "Alt+7"],
    ["⌘,", "Cmd+,"],
    ["⌘[", "Cmd+["],
    ["⌘]", "Cmd+]"],
    ["⌘`", "Cmd+`"],
    ["⌘-", "Cmd+-"],
    ["⌘0", "Cmd+0"],
    // muda 的 parse_code 沒有 Plus token，zoom-in 必須映射到 Equal
    ["⌘+", "Cmd+Equal"],
  ])("converts %s to %s", (mac, expected) => {
    expect(macShortcutToAccelerator(mac)).toBe(expected);
  });

  it("returns empty string when there is no key", () => {
    expect(macShortcutToAccelerator("⌘")).toBe("");
  });
});
