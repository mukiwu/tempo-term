import { useLayoutEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSettingsStore, type BackgroundImageScope } from "@/stores/settingsStore";
import { useBackgroundImage } from "@/lib/useBackgroundImage";
import { useBackgroundImageDraftStore } from "@/stores/backgroundImageDraftStore";

/** Where this layer's image lands, in viewport coordinates. */
const VARS = ["--wallpaper-image", "--wallpaper-fixed-size", "--wallpaper-fixed-pos"] as const;

/**
 * Decorative app-managed image painted behind translucent theme surfaces.
 * Scope owners mount their own layer, so workspace mode never bleeds into the
 * dock columns while window mode naturally covers the full shell.
 *
 * The editor's line-number gutter has to repaint this image to cover the code
 * that scrolls under it (see gutterWallpaper in themes/editorTheme.ts), and it
 * can only pin a background to the viewport, not to this layer's box. So the
 * layer publishes where `object-fit: cover` actually put the image, in viewport
 * coordinates, for `background-attachment: fixed` to reproduce exactly.
 */
export function BackgroundImageLayer({ scope }: { scope: BackgroundImageScope }) {
  const { path, active, previewingDraft } = useBackgroundImage(scope);
  const imageRef = useRef<HTMLImageElement>(null);
  const src = path && active ? convertFileSrc(path) : null;

  useLayoutEffect(() => {
    const image = imageRef.current;
    const root = document.documentElement;
    if (!image || !src) {
      return;
    }
    const publish = () => {
      const { naturalWidth, naturalHeight } = image;
      const box = image.getBoundingClientRect();
      if (!naturalWidth || !naturalHeight || !box.width || !box.height) {
        return;
      }
      // The same geometry `object-fit: cover` + `object-position: center` uses.
      const scale = Math.max(box.width / naturalWidth, box.height / naturalHeight);
      const width = naturalWidth * scale;
      const height = naturalHeight * scale;
      root.style.setProperty("--wallpaper-image", `url("${src}")`);
      root.style.setProperty("--wallpaper-fixed-size", `${width}px ${height}px`);
      root.style.setProperty(
        "--wallpaper-fixed-pos",
        `${box.left + (box.width - width) / 2}px ${box.top + (box.height - height) / 2}px`,
      );
    };
    publish();
    // Only ever fires on layout changes — a pane resize, the dock collapsing,
    // the window itself. Nothing here rides on scrolling.
    const observer = new ResizeObserver(publish);
    observer.observe(image);
    image.addEventListener("load", publish);
    return () => {
      observer.disconnect();
      image.removeEventListener("load", publish);
      for (const name of VARS) {
        root.style.removeProperty(name);
      }
    };
  }, [src]);

  if (!src) {
    return null;
  }

  return (
    <img
      ref={imageRef}
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-testid={`background-image-${scope}`}
      onError={() => {
        if (previewingDraft) {
          useBackgroundImageDraftStore.getState().markImageFailed();
        } else {
          useSettingsStore.getState().clearBackgroundImage();
        }
      }}
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full select-none object-cover object-center"
    />
  );
}
