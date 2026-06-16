import enCommon from "./locales/en/common.json";
import enSettings from "./locales/en/settings.json";
import enExplorer from "./locales/en/explorer.json";
import enEditor from "./locales/en/editor.json";
import enSourceControl from "./locales/en/sourceControl.json";
import enAi from "./locales/en/ai.json";
import enNotes from "./locales/en/notes.json";
import enPreview from "./locales/en/preview.json";
import enGitGraph from "./locales/en/gitGraph.json";
import zhHantCommon from "./locales/zh-Hant/common.json";
import zhHantSettings from "./locales/zh-Hant/settings.json";
import zhHantExplorer from "./locales/zh-Hant/explorer.json";
import zhHantEditor from "./locales/zh-Hant/editor.json";
import zhHantSourceControl from "./locales/zh-Hant/sourceControl.json";
import zhHantAi from "./locales/zh-Hant/ai.json";
import zhHantNotes from "./locales/zh-Hant/notes.json";
import zhHantPreview from "./locales/zh-Hant/preview.json";
import zhHantGitGraph from "./locales/zh-Hant/gitGraph.json";

export const SUPPORTED_LANGUAGES = ["en", "zh-Hant"] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

export const NAMESPACES = [
  "common",
  "settings",
  "explorer",
  "editor",
  "sourceControl",
  "ai",
  "notes",
  "preview",
  "gitGraph",
] as const;

export const DEFAULT_NAMESPACE = "common";

export const resources = {
  en: {
    common: enCommon,
    settings: enSettings,
    explorer: enExplorer,
    editor: enEditor,
    sourceControl: enSourceControl,
    ai: enAi,
    notes: enNotes,
    preview: enPreview,
    gitGraph: enGitGraph,
  },
  "zh-Hant": {
    common: zhHantCommon,
    settings: zhHantSettings,
    explorer: zhHantExplorer,
    editor: zhHantEditor,
    sourceControl: zhHantSourceControl,
    ai: zhHantAi,
    notes: zhHantNotes,
    preview: zhHantPreview,
    gitGraph: zhHantGitGraph,
  },
} as const;

/**
 * Map a raw locale string (for example "zh-TW", "zh-HK", "en-US") onto one of
 * the languages we actually ship. Anything Traditional-Chinese-ish resolves to
 * zh-Hant, everything else falls back to English.
 */
export function resolveLanguage(raw: string | undefined | null): SupportedLanguage {
  if (!raw) {
    return DEFAULT_LANGUAGE;
  }

  const normalized = raw.toLowerCase();

  if (
    normalized.startsWith("zh-hant") ||
    normalized === "zh-tw" ||
    normalized === "zh-hk" ||
    normalized === "zh-mo"
  ) {
    return "zh-Hant";
  }

  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(raw)) {
    return raw as SupportedLanguage;
  }

  return DEFAULT_LANGUAGE;
}
