import { describe, expect, it } from "vitest";
import { buildMenus, computeVisibleCount, type MenuContext } from "./menuBarMenus";
import { PANEL_IDS, type PanelId } from "@/stores/uiStore";

const baseCtx: MenuContext = {
  paneKind: "terminal",
  leafCount: 1,
  hasPreviewPane: false,
  isMaximized: false,
  panelOrder: [...PANEL_IDS],
};

describe("buildMenus", () => {
  it("returns the 6 top-level menus in spec order", () => {
    const menus = buildMenus(baseCtx);
    expect(menus.map((m) => m.id)).toEqual([
      "file", "edit", "view", "terminal", "window", "help",
    ]);
    // One submenu entry per dockable panel (the eight panels).
    const view = menus.find((m) => m.id === "view");
    const sidebar = view?.items.find((i) => i.id === "sidebar-panel");
    expect(sidebar?.submenu).toHaveLength(8);
  });

  it("builds the panel submenu from the live dock order — not a fixed default", () => {
    // The user dragged "sessions" to the front; the ⌥N shortcut hints in
    // menuBarMenus.ts must match that live order, not the shipped default.
    const reordered: PanelId[] = ["sessions", ...PANEL_IDS.filter((v) => v !== "sessions")];
    const ctx: MenuContext = { ...baseCtx, panelOrder: reordered };
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

describe("computeVisibleCount", () => {
  it("shows every button when they all fit (no overflow needed)", () => {
    // total 150 ≤ 200 → all six-ish fit, returns the full count.
    expect(computeVisibleCount([50, 50, 50], 30, 200)).toBe(3);
  });

  it("reserves room for the […] button and collapses the rest", () => {
    // total 300 > 200, so the […] button (30) must fit alongside kept buttons:
    // 50+50+50 = 150, +30 = 180 ≤ 200; a 4th would be 200+30 > 200 → 3 visible.
    expect(computeVisibleCount([50, 50, 50, 50, 50, 50], 30, 200)).toBe(3);
  });

  it("can collapse everything into […] when even one button won't fit beside it", () => {
    // 100 + 40 = 140 > 120 → 0 visible, all six go under the […] button.
    expect(computeVisibleCount([100, 100], 40, 120)).toBe(0);
  });

  it("returns the full count for unmeasured widths (0), so the bar never renders empty", () => {
    // Before the first layout pass (and in non-layout test envs) every width and
    // the available width are 0 — treat that as 'everything fits'.
    expect(computeVisibleCount([0, 0, 0, 0, 0, 0], 0, 0)).toBe(6);
  });
});
