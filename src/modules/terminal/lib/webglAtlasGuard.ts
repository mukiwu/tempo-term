import type { WebglAddon } from "@xterm/addon-webgl";

/**
 * The xterm WebGL renderer caches rasterized glyphs in a bounded texture atlas
 * (a few pages, each up to 4096px). It keys glyphs by character AND colour AND
 * style, so a long session with lots of distinct CJK glyphs in varied colours
 * (AI agents, syntax-highlighted output) steadily fills the atlas. Once it hits
 * the page limit the renderer tries to merge pages, and when that fails it
 * starts drawing the WRONG glyph — the garbled CJK text users hit on long
 * sessions. Clearing the atlas resets it (which is why changing the font, which
 * rebuilds the atlas, fixes it). This module clears the atlas automatically just
 * before it overflows, so the corruption never appears.
 */

/** Hard ceilings from the WebGL renderer's atlas implementation. */
const MAX_SUPPORTED_PAGES = 32;
const SAFETY_MARGIN_PAGES = 2;
const FALLBACK_THRESHOLD = 12;

/**
 * Tracks atlas page pressure and decides when to clear. Pure and synchronous so
 * the clear policy can be unit-tested without a GPU: feed it the renderer's
 * page add/remove signals and it tells you when to clear.
 */
export class AtlasPressureGuard {
  private pages = 0;
  /** True between requesting a clear and `reset()`, so the redraw's own
   *  re-added pages can't immediately trigger another clear (a clear loop). */
  private cooling = false;

  constructor(private readonly threshold: number) {}

  /** A page was added to the atlas. Returns true when the atlas should be
   *  cleared now (the count reached the threshold and we're not cooling down). */
  recordAdd(): boolean {
    this.pages += 1;
    if (this.cooling) {
      return false;
    }
    if (this.pages >= this.threshold) {
      this.cooling = true;
      return true;
    }
    return false;
  }

  /** A page was removed (e.g. the renderer merged pages); floored at zero. */
  recordRemove(): void {
    if (this.pages > 0) {
      this.pages -= 1;
    }
  }

  /** Re-arm after a clear has settled: zero the count and end the cooldown so a
   *  later genuine build-up can trigger the next clear. */
  reset(): void {
    this.pages = 0;
    this.cooling = false;
  }
}

/**
 * Probe the device's fragment-shader texture-unit limit, which caps how many
 * atlas pages the renderer can hold (`min(32, MAX_TEXTURE_IMAGE_UNITS)`). We
 * clear a couple of pages before that ceiling. Returns a safe fallback when WebGL
 * is unavailable (the guard still works, just with a conservative threshold).
 */
export function detectAtlasClearThreshold(fallback: number = FALLBACK_THRESHOLD): number {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) {
      return fallback;
    }
    const units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
    const maxPages = Math.min(MAX_SUPPORTED_PAGES, units);
    // Clear before the ceiling so a merge failure can't corrupt glyphs first.
    return Math.max(2, maxPages - SAFETY_MARGIN_PAGES);
  } catch {
    return fallback;
  }
}

/**
 * Wire an `AtlasPressureGuard` to a live `WebglAddon`: when atlas pressure
 * reaches the threshold, clear the atlas and re-arm on the next tick (after the
 * clear's redraw has re-rasterized the visible glyphs). Returns a disposer that
 * detaches the listeners.
 */
export function installAtlasPressureGuard(
  addon: WebglAddon,
  threshold: number = detectAtlasClearThreshold(),
): () => void {
  const guard = new AtlasPressureGuard(threshold);

  const added = addon.onAddTextureAtlasCanvas(() => {
    if (guard.recordAdd()) {
      addon.clearTextureAtlas();
      // The clear removes every page (firing onRemove) and its redraw re-adds a
      // few for the visible glyphs. Re-arm on the next tick so those settle into
      // a clean baseline instead of immediately re-triggering.
      queueMicrotask(() => guard.reset());
    }
  });
  const removed = addon.onRemoveTextureAtlasCanvas(() => guard.recordRemove());

  return () => {
    added.dispose();
    removed.dispose();
  };
}
