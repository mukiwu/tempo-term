import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LANGUAGE, type SupportedLanguage } from "@/i18n/config";
import { DEFAULT_THEME_ID } from "@/themes/themes";

export const MIN_TERMINAL_PADDING = 0;
export const MAX_TERMINAL_PADDING = 40;
export const DEFAULT_TERMINAL_PADDING = 10;

export const MIN_UI_ZOOM = 0.5;
export const MAX_UI_ZOOM = 2;
export const UI_ZOOM_STEP = 0.1;
export const DEFAULT_UI_ZOOM = 1;

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
  /** Include the active terminal's output in the AI assistant context by default. */
  aiTerminalContext: boolean;
  /** Suggest previously-run commands as ghost text in the terminal. */
  terminalSuggestions: boolean;
  /** Show the hover action card (ping/curl/extract) over IPs, host:port and archives. */
  actionLinksEnabled: boolean;
  /** Webview zoom factor for the whole UI (1 = 100%); driven by ⌘+ / ⌘-. */
  uiZoom: number;
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
  setAiTerminalContext: (value: boolean) => void;
  setTerminalSuggestions: (value: boolean) => void;
  setActionLinksEnabled: (value: boolean) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

export const SETTINGS_STORAGE_KEY = "tempoterm-settings";

function clampPadding(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_TERMINAL_PADDING;
  }
  return Math.min(MAX_TERMINAL_PADDING, Math.max(MIN_TERMINAL_PADDING, Math.round(value)));
}

function clampZoom(value: number): number {
  // Guard against non-numbers too (e.g. null/undefined from an older persisted
  // settings blob): NaN alone wouldn't catch them and Math.min/max would yield NaN.
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_UI_ZOOM;
  }
  const clamped = Math.min(MAX_UI_ZOOM, Math.max(MIN_UI_ZOOM, value));
  // Round to one decimal so repeated steps don't drift (1.1 + 0.1 = 1.2, not 1.2000001).
  return Math.round(clamped * 10) / 10;
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
      aiTerminalContext: true,
      terminalSuggestions: true,
      actionLinksEnabled: true,
      uiZoom: DEFAULT_UI_ZOOM,
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
      setAiTerminalContext: (value) => set({ aiTerminalContext: value }),
      setTerminalSuggestions: (value) => set({ terminalSuggestions: value }),
      setActionLinksEnabled: (value) => set({ actionLinksEnabled: value }),
      zoomIn: () => set((s) => ({ uiZoom: clampZoom(s.uiZoom + UI_ZOOM_STEP) })),
      zoomOut: () => set((s) => ({ uiZoom: clampZoom(s.uiZoom - UI_ZOOM_STEP) })),
      resetZoom: () => set({ uiZoom: DEFAULT_UI_ZOOM }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
    },
  ),
);
