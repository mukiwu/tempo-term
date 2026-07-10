import { useSettingsStore } from "@/stores/settingsStore";
import type { SupportedLanguage } from "@/i18n/config";

/**
 * The display language the app booted with. macOS reads the per-app
 * AppleLanguages preference once at launch, so native menus (kept in editors
 * and notes) only follow a language change after a restart — the settings
 * panel compares against this to know when to show its restart hint.
 */
export const LANGUAGE_AT_LAUNCH: SupportedLanguage = useSettingsStore.getState().language;
