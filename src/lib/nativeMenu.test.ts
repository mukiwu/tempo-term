import { describe, expect, it } from "vitest";
import {
  findItemById,
  macShortcutToAccelerator,
  serializeNativeMenu,
  type NativeMenuItem,
} from "@/lib/nativeMenu";
import { buildMenus, type MenuContext } from "@/components/menuBarMenus";
import en from "@/i18n/locales/en/common.json";
import zhHant from "@/i18n/locales/zh-Hant/common.json";

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

function resolveKey(resources: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>(
    (node, part) =>
      node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
    resources,
  );
}

const baseCtx: MenuContext = {
  paneKind: "terminal",
  leafCount: 2,
  hasPreviewPane: false,
  isMaximized: false,
  panelOrder: ["workspaces", "explorer", "sourceControl", "notes", "ai", "connections", "sessions", "ports"],
};

const t = (key: string) => key; // identity；label 內容用 key 斷言，翻譯覆蓋另測

describe("serializeNativeMenu", () => {
  it("keeps the six top-level menus in order", () => {
    const model = serializeNativeMenu(t, baseCtx);
    expect(model.menus.map((m) => m.id)).toEqual([
      "file", "edit", "view", "terminal", "window", "help",
    ]);
  });

  it("inserts separators exactly at group boundaries", () => {
    const model = serializeNativeMenu(t, baseCtx);
    const file = model.menus[0];
    // file 選單 group 0|1|2|3 → 8 個項目 + 3 個 separator
    expect(file.items.filter((i) => i.kind === "separator")).toHaveLength(3);
    expect(file.items.map((i) => i.kind)).toEqual([
      "custom", "custom", "custom", "separator", "custom", "separator",
      "custom", "custom", "separator", "custom", "custom",
    ]);
  });

  it("maps copy / paste / select-all to predefined items without accelerator", () => {
    const model = serializeNativeMenu(t, baseCtx);
    const edit = model.menus[1];
    const copy = edit.items.find((i) => i.id === "copy");
    expect(copy).toMatchObject({ kind: "predefined", predefined: "copy" });
    expect(copy?.accelerator).toBeUndefined();
    expect(edit.items.find((i) => i.id === "paste")?.predefined).toBe("paste");
    expect(edit.items.find((i) => i.id === "select-all")?.predefined).toBe("selectAll");
  });

  it("prepends native undo / redo / cut to the edit menu", () => {
    const model = serializeNativeMenu(t, baseCtx);
    const edit = model.menus[1];
    expect(edit.items.slice(0, 4).map((i) => [i.kind, i.predefined ?? "sep"])).toEqual([
      ["predefined", "undo"],
      ["predefined", "redo"],
      ["separator", "sep"],
      ["predefined", "cut"],
    ]);
  });

  it("maps disabled predicates into enabled flags", () => {
    const editorCtx: MenuContext = { ...baseCtx, paneKind: "editor", leafCount: 1 };
    const model = serializeNativeMenu(t, editorCtx);
    const file = model.menus[0];
    expect(file.items.find((i) => i.id === "save")?.enabled).toBe(true);
    const terminal = model.menus[3];
    expect(terminal.items.find((i) => i.id === "cycle-pane")?.enabled).toBe(false);
    expect(terminal.items.find((i) => i.id === "clear-buffer")?.enabled).toBe(false);
  });

  it("serializes the sidebar submenu from ctx order with alt accelerators", () => {
    const reordered: MenuContext = {
      ...baseCtx,
      panelOrder: ["notes", "explorer", "workspaces", "sourceControl", "ai", "connections", "sessions", "ports"],
    };
    const model = serializeNativeMenu(t, reordered);
    const view = model.menus[2];
    const panel = view.items.find((i) => i.id === "sidebar-panel");
    expect(panel?.kind).toBe("custom");
    expect(panel?.items?.map((i) => i.id)).toEqual([
      "sidebar-notes", "sidebar-explorer", "sidebar-workspaces", "sidebar-sourceControl",
      "sidebar-ai", "sidebar-connections", "sidebar-sessions", "sidebar-ports",
    ]);
    expect(panel?.items?.[0].accelerator).toBe("Alt+1");
    expect(panel?.items?.[7].accelerator).toBe("Alt+8");
  });

  it("converts the zoom-in shortcut to Cmd+Equal", () => {
    const model = serializeNativeMenu(t, baseCtx);
    const view = model.menus[2];
    expect(view.items.find((i) => i.id === "zoom-in")?.accelerator).toBe("Cmd+Equal");
  });

  it("resolves every label key in both locales", () => {
    const keys = new Set<string>();
    const collect = (items: NativeMenuItem[]) => {
      for (const item of items) {
        if (item.kind !== "separator" && item.label) keys.add(item.label);
        if (item.items) collect(item.items);
      }
    };
    const model = serializeNativeMenu(t, baseCtx); // identity t → label 就是 key
    for (const menu of model.menus) {
      keys.add(menu.label);
      collect(menu.items);
    }
    for (const key of keys) {
      expect(resolveKey(en, key), `en missing ${key}`).toBeTypeOf("string");
      expect(resolveKey(zhHant, key), `zh-Hant missing ${key}`).toBeTypeOf("string");
    }
  });
});

describe("findItemById", () => {
  it("finds top-level items and submenu children", () => {
    const menus = buildMenus(baseCtx);
    expect(findItemById(menus, "new-tab")?.id).toBe("new-tab");
    expect(findItemById(menus, "sidebar-notes")?.id).toBe("sidebar-notes");
    expect(findItemById(menus, "nope")).toBeUndefined();
  });
});
