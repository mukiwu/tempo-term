import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LANGUAGE, type SupportedLanguage } from "@/i18n/config";

export type Theme = "dark" | "light";

interface SettingsState {
  language: SupportedLanguage;
  theme: Theme;
  setLanguage: (language: SupportedLanguage) => void;
  setTheme: (theme: Theme) => void;
}

export const SETTINGS_STORAGE_KEY = "tempoterm-settings";

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: DEFAULT_LANGUAGE,
      theme: "dark",
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
    },
  ),
);
