import { convertFileSrc } from "@tauri-apps/api/core";
import { useSettingsStore, type BackgroundImageScope } from "@/stores/settingsStore";

/**
 * Decorative app-managed image painted behind translucent theme surfaces.
 * Scope owners mount their own layer, so workspace mode never bleeds into the
 * dock columns while window mode naturally covers the full shell.
 */
export function BackgroundImageLayer({ scope }: { scope: BackgroundImageScope }) {
  const path = useSettingsStore((state) => state.backgroundImagePath);
  const opacity = useSettingsStore((state) => state.backgroundImageOpacity);
  const configuredScope = useSettingsStore((state) => state.backgroundImageScope);

  if (!path || opacity <= 0 || configuredScope !== scope) {
    return null;
  }

  return (
    <img
      src={convertFileSrc(path)}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-testid={`background-image-${scope}`}
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full select-none object-cover object-center"
      style={{ opacity: opacity / 100 }}
    />
  );
}
