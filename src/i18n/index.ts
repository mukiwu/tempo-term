import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_NAMESPACE,
  NAMESPACES,
  resolveLanguage,
  resources,
} from "./config";
import { SETTINGS_STORAGE_KEY, useSettingsStore } from "@/stores/settingsStore";

/**
 * On first launch the user has no saved preference, so follow the system
 * language. Once they pick a language explicitly it lives in the settings
 * store and wins on every later launch.
 */
function detectInitialLanguage() {
  const hasSavedPreference =
    typeof localStorage !== "undefined" &&
    localStorage.getItem(SETTINGS_STORAGE_KEY) !== null;

  if (hasSavedPreference) {
    return useSettingsStore.getState().language;
  }

  const system = resolveLanguage(
    typeof navigator !== "undefined" ? navigator.language : undefined,
  );
  useSettingsStore.getState().setLanguage(system);
  return system;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLanguage(),
  fallbackLng: "en",
  defaultNS: DEFAULT_NAMESPACE,
  ns: [...NAMESPACES],
  interpolation: {
    escapeValue: false,
  },
});

// Keep i18next in lockstep with the settings store. Any place that calls
// setLanguage (the settings panel, a shortcut) updates the UI immediately.
useSettingsStore.subscribe((state) => {
  if (i18n.language !== state.language) {
    void i18n.changeLanguage(state.language);
  }
});

export default i18n;
