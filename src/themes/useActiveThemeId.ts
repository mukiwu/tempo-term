import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";

/**
 * The theme the window paints with: the one being previewed while the
 * pointer rests on a theme in settings, otherwise the chosen one.
 */
export function useActiveThemeId(): string {
  const previewThemeId = useUiStore((s) => s.previewThemeId);
  const themeId = useSettingsStore((s) => s.themeId);
  return previewThemeId ?? themeId;
}

/** `useActiveThemeId` for code outside React rendering. */
export function activeThemeId(): string {
  return useUiStore.getState().previewThemeId ?? useSettingsStore.getState().themeId;
}
