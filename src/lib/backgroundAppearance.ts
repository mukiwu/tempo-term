import type { CSSProperties } from "react";
import { getTheme } from "@/themes/themes";

const DARK_SURFACE_VISIBILITY_FACTOR = 0.9;
const DARK_ELEVATED_VISIBILITY_FACTOR = 0.4;
const LIGHT_SURFACE_VISIBILITY_FACTOR = 0.6;
const LIGHT_ELEVATED_VISIBILITY_FACTOR = 0.3;

export interface BackgroundSurfaceAlphas {
  surface: number;
  elevated: number;
}

type BackgroundSurfaceStyle = CSSProperties & {
  "--wallpaper-surface-alpha": string;
  "--wallpaper-elevated-alpha": string;
  "--color-fg"?: string;
  "--color-fg-muted"?: string;
  "--color-fg-subtle"?: string;
};

function clampOpacity(opacity: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(opacity) ? opacity : 0));
}

function roundedAlpha(alpha: number): number {
  return Math.round(alpha * 1000) / 1000;
}

/**
 * Convert the user-facing image opacity into the tint painted over broad and
 * elevated surfaces. The image itself stays opaque underneath the app so the
 * opacity is applied exactly once instead of being multiplied by every nested
 * component background.
 *
 * At the 20% default this produces the design targets: 82%/92% tint in dark
 * themes and 88%/94% in light themes.
 */
export function backgroundSurfaceAlphas(
  themeId: string,
  opacity: number,
): BackgroundSurfaceAlphas {
  const visibility = clampOpacity(opacity) / 100;
  const light = getTheme(themeId).appearance === "light";
  const surfaceFactor = light
    ? LIGHT_SURFACE_VISIBILITY_FACTOR
    : DARK_SURFACE_VISIBILITY_FACTOR;
  const elevatedFactor = light
    ? LIGHT_ELEVATED_VISIBILITY_FACTOR
    : DARK_ELEVATED_VISIBILITY_FACTOR;

  return {
    surface: roundedAlpha(1 - visibility * surfaceFactor),
    elevated: roundedAlpha(1 - visibility * elevatedFactor),
  };
}

export function backgroundSurfaceStyle(
  themeId: string,
  opacity: number,
  textColor: string | null = null,
): BackgroundSurfaceStyle {
  const alphas = backgroundSurfaceAlphas(themeId, opacity);
  const style: BackgroundSurfaceStyle = {
    "--wallpaper-surface-alpha": `${alphas.surface * 100}%`,
    "--wallpaper-elevated-alpha": `${alphas.elevated * 100}%`,
  };
  if (textColor) {
    style["--color-fg"] = textColor;
    style["--color-fg-muted"] = `color-mix(in srgb, ${textColor} 88%, transparent)`;
    style["--color-fg-subtle"] = `color-mix(in srgb, ${textColor} 76%, transparent)`;
  }
  return style;
}
