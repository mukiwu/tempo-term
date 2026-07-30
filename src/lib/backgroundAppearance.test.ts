import { describe, expect, it } from "vitest";
import { backgroundSurfaceAlphas, backgroundSurfaceStyle } from "./backgroundAppearance";

describe("background appearance", () => {
  it("matches the default dark and light readability masks", () => {
    expect(backgroundSurfaceAlphas("vitesse-dark", 20)).toEqual({
      surface: 0.82,
      elevated: 0.92,
    });
    expect(backgroundSurfaceAlphas("vitesse-light", 20)).toEqual({
      surface: 0.88,
      elevated: 0.94,
    });
  });

  it("applies opacity once and clamps invalid input", () => {
    expect(backgroundSurfaceAlphas("vitesse-dark", 0).surface).toBe(1);
    expect(backgroundSurfaceAlphas("vitesse-dark", 100).surface).toBeCloseTo(0.1);
    expect(backgroundSurfaceAlphas("vitesse-light", 150).surface).toBeCloseTo(0.4);
    expect(backgroundSurfaceAlphas("vitesse-light", Number.NaN).surface).toBe(1);
  });

  it("exposes percentages for semantic surface tokens", () => {
    expect(backgroundSurfaceStyle("vitesse-light", 20)).toEqual({
      "--wallpaper-surface-alpha": "88%",
      "--wallpaper-elevated-alpha": "94%",
    });
  });

  it("derives readable hierarchy from a custom foreground", () => {
    expect(backgroundSurfaceStyle("vitesse-dark", 20, "#f4f7ff")).toEqual({
      "--wallpaper-surface-alpha": "82%",
      "--wallpaper-elevated-alpha": "92%",
      "--color-fg": "#f4f7ff",
      "--color-fg-muted": "color-mix(in srgb, #f4f7ff 88%, transparent)",
      "--color-fg-subtle": "color-mix(in srgb, #f4f7ff 76%, transparent)",
    });
  });
});
