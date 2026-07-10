/**
 * Serializes the frontend menu tree (menuBarMenus.ts) into the model the Rust
 * `set_native_menu` command consumes to rebuild the native macOS menu bar.
 * macOS-only path; Windows keeps the in-window WindowMenuBar untouched.
 */

import {
  buildMenus,
  type MenuContext,
  type MenuDef,
  type MenuItemDef,
} from "@/components/menuBarMenus";

const MOD_GLYPHS: Record<string, string> = {
  "⌘": "Cmd",
  "⇧": "Shift",
  "⌥": "Alt",
  "⌃": "Ctrl",
};

// muda's accelerator parser has no Plus token, so the zoom-in glyph must map
// to Equal (menu shows ⌘=, same as Chrome / VSCode).
const KEY_MAP: Record<string, string> = { "+": "Equal" };

export function macShortcutToAccelerator(mac: string): string {
  const mods: string[] = [];
  let key = "";
  for (const ch of [...mac]) {
    const mod = MOD_GLYPHS[ch];
    if (mod) mods.push(mod);
    else key += ch;
  }
  if (!key) return "";
  return [...mods, KEY_MAP[key] ?? key.toUpperCase()].join("+");
}

export type NativeItemKind = "custom" | "separator" | "predefined";

export interface NativeMenuItem {
  id: string;
  label: string;
  enabled: boolean;
  accelerator?: string;
  kind: NativeItemKind;
  predefined?: string;
  items?: NativeMenuItem[];
}

export interface NativeMenu {
  id: string;
  label: string;
  items: NativeMenuItem[];
}

export interface NativeMenuModel {
  menus: NativeMenu[];
}

/** Item ids whose native counterpart must stay a system predefined item so the
 *  OS keeps routing Cmd+C / Cmd+V / Cmd+A into the focused webview. */
const PREDEFINED_BY_ID: Record<string, string> = {
  copy: "copy",
  paste: "paste",
  "select-all": "selectAll",
};

const SEPARATOR: Omit<NativeMenuItem, "id"> = { label: "", enabled: false, kind: "separator" };

type Translate = (key: string) => string;

/** The in-window menu has no undo / redo / cut (terminals don't need them), but
 *  the native macOS Edit menu must keep them as predefined items so system
 *  Cmd+Z / Shift+Cmd+Z / Cmd+X routing into text fields survives (same as the
 *  pre-model minimal menu). Injected here so menuBarMenus.ts stays untouched. */
function editNativePrefix(t: Translate): NativeMenuItem[] {
  return [
    { id: "native-undo", label: t("menuBar.undo"), enabled: true, kind: "predefined", predefined: "undo" },
    { id: "native-redo", label: t("menuBar.redo"), enabled: true, kind: "predefined", predefined: "redo" },
    { id: "sep-edit-native", ...SEPARATOR },
    { id: "native-cut", label: t("menuBar.cut"), enabled: true, kind: "predefined", predefined: "cut" },
  ];
}

function serializeItems(t: Translate, items: MenuItemDef[], ctx: MenuContext): NativeMenuItem[] {
  const out: NativeMenuItem[] = [];
  let prevGroup: number | undefined;
  for (const item of items) {
    if (prevGroup !== undefined && item.group !== prevGroup) {
      out.push({ id: `sep-${out.length}`, ...SEPARATOR });
    }
    prevGroup = item.group;

    const predefined = PREDEFINED_BY_ID[item.id];
    if (predefined) {
      out.push({ id: item.id, label: t(item.labelKey), enabled: true, kind: "predefined", predefined });
      continue;
    }

    const serialized: NativeMenuItem = {
      id: item.id,
      label: t(item.labelKey),
      enabled: !(item.disabled?.(ctx) ?? false),
      kind: "custom",
    };
    if (item.submenu) {
      serialized.items = serializeItems(t, item.submenu, ctx);
    } else if (item.shortcut) {
      const accelerator = macShortcutToAccelerator(item.shortcut.mac);
      if (accelerator) serialized.accelerator = accelerator;
    }
    out.push(serialized);
  }
  return out;
}

export function serializeNativeMenu(t: Translate, ctx: MenuContext): NativeMenuModel {
  return {
    menus: buildMenus(ctx).map((menu) => ({
      id: menu.id,
      label: t(menu.labelKey),
      items:
        menu.id === "edit"
          ? [...editNativePrefix(t), ...serializeItems(t, menu.items, ctx)]
          : serializeItems(t, menu.items, ctx),
    })),
  };
}

function findInItems(items: MenuItemDef[], id: string): MenuItemDef | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.submenu) {
      const found = findInItems(item.submenu, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Locate the tree item a native-menu click id refers to (submenus included). */
export function findItemById(menus: MenuDef[], id: string): MenuItemDef | undefined {
  for (const menu of menus) {
    const found = findInItems(menu.items, id);
    if (found) return found;
  }
  return undefined;
}
