import { describe, expect, it } from "vitest";
import {
  applyTheme,
  cssVariablesFor,
  DEFAULT_THEME_ID,
  getTheme,
  THEMES,
} from "./themes";

describe("themes registry", () => {
  it("exposes the default theme and several choices", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(3);
    expect(getTheme(DEFAULT_THEME_ID).id).toBe(DEFAULT_THEME_ID);
  });

  it("falls back to the first theme for an unknown id", () => {
    expect(getTheme("does-not-exist")).toBe(THEMES[0]);
  });

  it("gives every theme a full set of semantic colours and an xterm palette", () => {
    for (const theme of THEMES) {
      const vars = cssVariablesFor(theme);
      expect(Object.keys(vars)).toHaveLength(13);
      expect(vars["--color-bg"]).toMatch(/^#/);
      expect(theme.terminal.background).toMatch(/^#/);
      expect(theme.terminal.foreground).toMatch(/^#/);
    }
  });
});

describe("applyTheme", () => {
  it("writes the CSS variables, data-theme and colour-scheme onto the root", () => {
    const root = document.createElement("div");
    const theme = getTheme("github-dark");
    applyTheme(theme, root);
    expect(root.style.getPropertyValue("--color-bg")).toBe(theme.colors.bg);
    expect(root.style.getPropertyValue("--color-accent")).toBe(theme.colors.accent);
    expect(root.dataset.theme).toBe("github-dark");
    expect(root.style.colorScheme).toBe("dark");
  });

  it("sets colour-scheme to light for light themes", () => {
    const root = document.createElement("div");
    applyTheme(getTheme("vitesse-light"), root);
    expect(root.style.colorScheme).toBe("light");
  });
});
