import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LANGUAGE, type SupportedLanguage } from "@/i18n/config";
import { DEFAULT_THEME_ID } from "@/themes/themes";

export const MIN_TERMINAL_PADDING = 0;
export const MAX_TERMINAL_PADDING = 40;
export const DEFAULT_TERMINAL_PADDING = 10;

interface SettingsState {
  language: SupportedLanguage;
  themeId: string;
  /** Inner padding (px) between the terminal content and its pane edges. */
  terminalPadding: number;
  wordWrap: boolean;
  /** Persist each terminal's scrollback and restore it on next launch. */
  restoreTerminalHistory: boolean;
  setLanguage: (language: SupportedLanguage) => void;
  setThemeId: (themeId: string) => void;
  setTerminalPadding: (padding: number) => void;
  toggleWordWrap: () => void;
  setRestoreTerminalHistory: (value: boolean) => void;
}

export const SETTINGS_STORAGE_KEY = "tempoterm-settings";

function clampPadding(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_TERMINAL_PADDING;
  }
  return Math.min(MAX_TERMINAL_PADDING, Math.max(MIN_TERMINAL_PADDING, Math.round(value)));
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: DEFAULT_LANGUAGE,
      themeId: DEFAULT_THEME_ID,
      terminalPadding: DEFAULT_TERMINAL_PADDING,
      wordWrap: false,
      restoreTerminalHistory: true,
      setLanguage: (language) => set({ language }),
      setThemeId: (themeId) => set({ themeId }),
      setTerminalPadding: (padding) => set({ terminalPadding: clampPadding(padding) }),
      toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
      setRestoreTerminalHistory: (value) => set({ restoreTerminalHistory: value }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
    },
  ),
);
