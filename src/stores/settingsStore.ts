import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LANGUAGE, type SupportedLanguage } from "@/i18n/config";
import { DEFAULT_THEME_ID } from "@/themes/themes";

interface SettingsState {
  language: SupportedLanguage;
  themeId: string;
  setLanguage: (language: SupportedLanguage) => void;
  setThemeId: (themeId: string) => void;
}

export const SETTINGS_STORAGE_KEY = "tempoterm-settings";

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: DEFAULT_LANGUAGE,
      themeId: DEFAULT_THEME_ID,
      setLanguage: (language) => set({ language }),
      setThemeId: (themeId) => set({ themeId }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
    },
  ),
);
