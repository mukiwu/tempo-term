import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LANGUAGE, type SupportedLanguage } from "@/i18n/config";
import { DEFAULT_THEME_ID } from "@/themes/themes";

export const MIN_TERMINAL_PADDING = 0;
export const MAX_TERMINAL_PADDING = 40;
export const DEFAULT_TERMINAL_PADDING = 10;

/** Which info blocks each workspace card shows; all on by default. */
export interface WorkspaceCardBlocks {
  status: boolean;
  branch: boolean;
  cwd: boolean;
  pr: boolean;
}

/** Where PR data comes from; "auto" detects gh, else falls back to a token. */
export type WorkspacePrSource = "auto" | "gh" | "token" | "off";

const DEFAULT_WORKSPACE_CARD: WorkspaceCardBlocks = {
  status: true,
  branch: true,
  cwd: true,
  pr: true,
};

interface SettingsState {
  language: SupportedLanguage;
  themeId: string;
  /** Inner padding (px) between the terminal content and its pane edges. */
  terminalPadding: number;
  wordWrap: boolean;
  /** Persist each terminal's scrollback and restore it on next launch. */
  restoreTerminalHistory: boolean;
  /** Folder that backs global notes; null until the user picks one. */
  notesFolderPath: string | null;
  /** Which info blocks the workspace cards show. */
  workspaceCard: WorkspaceCardBlocks;
  /** Where workspace cards source PR data. */
  prSource: WorkspacePrSource;
  /** Install the Claude Code hook that reports live session status to cards. */
  claudeStatusTracking: boolean;
  /** Show AI ghost-text completions while typing in the code editor. */
  aiInlineCompletion: boolean;
  setLanguage: (language: SupportedLanguage) => void;
  setThemeId: (themeId: string) => void;
  setTerminalPadding: (padding: number) => void;
  toggleWordWrap: () => void;
  setRestoreTerminalHistory: (value: boolean) => void;
  setNotesFolderPath: (path: string | null) => void;
  setWorkspaceCardBlock: (key: keyof WorkspaceCardBlocks, value: boolean) => void;
  setPrSource: (source: WorkspacePrSource) => void;
  setClaudeStatusTracking: (value: boolean) => void;
  setAiInlineCompletion: (value: boolean) => void;
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
      notesFolderPath: null,
      workspaceCard: DEFAULT_WORKSPACE_CARD,
      prSource: "auto",
      claudeStatusTracking: true,
      aiInlineCompletion: false,
      setLanguage: (language) => set({ language }),
      setThemeId: (themeId) => set({ themeId }),
      setTerminalPadding: (padding) => set({ terminalPadding: clampPadding(padding) }),
      toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
      setRestoreTerminalHistory: (value) => set({ restoreTerminalHistory: value }),
      setNotesFolderPath: (path) => set({ notesFolderPath: path }),
      setWorkspaceCardBlock: (key, value) =>
        set((state) => ({ workspaceCard: { ...state.workspaceCard, [key]: value } })),
      setPrSource: (prSource) => set({ prSource }),
      setClaudeStatusTracking: (value) => set({ claudeStatusTracking: value }),
      setAiInlineCompletion: (value) => set({ aiInlineCompletion: value }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
    },
  ),
);
