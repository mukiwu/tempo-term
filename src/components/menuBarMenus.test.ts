import { describe, expect, it } from "vitest";
import { buildMenus, type MenuContext } from "./menuBarMenus";
import { DEFAULT_SIDEBAR_ORDER, type SidebarView } from "@/stores/uiStore";

const baseCtx: MenuContext = {
  paneKind: "terminal",
  leafCount: 1,
  hasPreviewPane: false,
  isMaximized: false,
  sidebarOrder: DEFAULT_SIDEBAR_ORDER,
};

describe("buildMenus", () => {
  it("returns the 6 top-level menus in spec order", () => {
    const menus = buildMenus(baseCtx);
    expect(menus.map((m) => m.id)).toEqual([
      "file", "edit", "view", "terminal", "window", "help",
    ]);
    // 6 menus + the sidebar submenu makes the 7th level of the spec tree
    const view = menus.find((m) => m.id === "view");
    const sidebar = view?.items.find((i) => i.id === "sidebar-panel");
    expect(sidebar?.submenu).toHaveLength(7);
  });

  it("builds the sidebar submenu from the live, user-reordered sidebarOrder — not the fixed default order", () => {
    // The user dragged "sessions" to the front in the icon bar; the ⌥N
    // shortcut hints in menuBarMenus.ts must match, not the shipped default.
    const reordered: SidebarView[] = [
      "sessions",
      ...DEFAULT_SIDEBAR_ORDER.filter((v) => v !== "sessions"),
    ];
    const ctx: MenuContext = { ...baseCtx, sidebarOrder: reordered };
    const menus = buildMenus(ctx);
    const view = menus.find((m) => m.id === "view");
    const sidebar = view?.items.find((i) => i.id === "sidebar-panel");
    expect(sidebar?.submenu?.map((i) => i.id)).toEqual(reordered.map((v) => `sidebar-${v}`));
    expect(sidebar?.submenu?.[0]?.shortcut).toEqual({ mac: "⌥1", win: "Alt+1" });
  });

  it("disables save unless the focused pane is an editor", () => {
    const menus = buildMenus(baseCtx);
    const save = menus[0].items.find((i) => i.id === "save");
    expect(save?.disabled?.(baseCtx)).toBe(true);
    expect(save?.disabled?.({ ...baseCtx, paneKind: "editor" })).toBe(false);
  });

  it("disables cycle-pane on a single pane and preview items without a preview", () => {
    const menus = buildMenus(baseCtx);
    const terminal = menus.find((m) => m.id === "terminal");
    const cycle = terminal?.items.find((i) => i.id === "cycle-pane");
    expect(cycle?.disabled?.(baseCtx)).toBe(true);
    expect(cycle?.disabled?.({ ...baseCtx, leafCount: 2 })).toBe(false);

    const view = menus.find((m) => m.id === "view");
    const back = view?.items.find((i) => i.id === "preview-back");
    expect(back?.disabled?.(baseCtx)).toBe(true);
    expect(back?.disabled?.({ ...baseCtx, hasPreviewPane: true })).toBe(false);
  });

  it("disables find-in-terminal and clear-buffer off terminal panes", () => {
    const ctx: MenuContext = { ...baseCtx, paneKind: "editor" };
    const menus = buildMenus(ctx);
    const find = menus.find((m) => m.id === "edit")!.items.find((i) => i.id === "find-in-terminal");
    const clear = menus.find((m) => m.id === "terminal")!.items.find((i) => i.id === "clear-buffer");
    expect(find?.disabled?.(ctx)).toBe(true);
    expect(clear?.disabled?.(ctx)).toBe(true);
  });

  it("every item resolves an i18n label key in both locales", async () => {
    const en = (await import("@/i18n/locales/en/common.json")).default as Record<string, unknown>;
    const zh = (await import("@/i18n/locales/zh-Hant/common.json")).default as Record<string, unknown>;
    const resolve = (obj: Record<string, unknown>, key: string) =>
      key.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part as never], obj);
    const keys: string[] = [];
    for (const menu of buildMenus(baseCtx)) {
      keys.push(menu.labelKey);
      for (const item of menu.items) {
        keys.push(item.labelKey);
        for (const child of item.submenu ?? []) keys.push(child.labelKey);
      }
    }
    for (const key of keys) {
      expect(resolve(en, key), `en missing ${key}`).toBeTruthy();
      expect(resolve(zh, key), `zh-Hant missing ${key}`).toBeTruthy();
    }
  });
});
