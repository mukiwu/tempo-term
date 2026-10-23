import type { TFunction } from "i18next";

/**
 * One searchable setting: the section it lives in, the i18n key of the label
 * it shows, and optionally the key of its hint so the search also matches
 * words that only appear in the description.
 */
export interface SettingsSearchEntry {
  section: "appearance" | "terminal" | "ai" | "workspace" | "gitGraph" | "shortcuts" | "about";
  labelKey: string;
  hintKey?: string;
}

const SHORTCUT_LABEL_KEYS = [
  "commandPalette",
  "newTerminalTab",
  "closeTab",
  "switchTab",
  "switchSidebar",
  "findFiles",
  "toggleSidebar",
  "toggleRightSidebar",
  "zoomIn",
  "zoomOut",
  "resetZoom",
  "settings",
  "splitRight",
  "splitDown",
  "cyclePane",
  "searchTerminal",
];

/** Every setting the settings search can find. A new setting is added here
 *  with the same label key its section renders, so the jump can locate it. */
export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  { section: "appearance", labelKey: "language.label", hintKey: "language.description" },
  { section: "appearance", labelKey: "theme.label" },
  { section: "appearance", labelKey: "background.label", hintKey: "background.description" },
  { section: "appearance", labelKey: "background.opacity", hintKey: "background.opacityHint" },
  { section: "appearance", labelKey: "background.textColor", hintKey: "background.textColorHint" },
  { section: "appearance", labelKey: "fonts.primary", hintKey: "fonts.description" },
  { section: "appearance", labelKey: "fonts.fontSize" },
  { section: "appearance", labelKey: "fonts.iconFont", hintKey: "fonts.iconFontHint" },
  { section: "terminal", labelKey: "terminalSettings.padding" },
  { section: "terminal", labelKey: "terminalSettings.customShell", hintKey: "terminalSettings.customShellHint" },
  { section: "terminal", labelKey: "terminalSettings.newTabCwd", hintKey: "terminalSettings.newTabCwdHint" },
  { section: "terminal", labelKey: "terminalSettings.confirmClose", hintKey: "terminalSettings.confirmCloseHint" },
  { section: "terminal", labelKey: "terminalSettings.suggestions", hintKey: "terminalSettings.suggestionsHint" },
  { section: "terminal", labelKey: "terminalSettings.copyOnSelect", hintKey: "terminalSettings.copyOnSelectHint" },
  { section: "terminal", labelKey: "terminalSettings.actionLinks", hintKey: "terminalSettings.actionLinksHint" },
  { section: "terminal", labelKey: "terminalSettings.restoreHistory", hintKey: "terminalSettings.restoreHistoryHint" },
  { section: "ai", labelKey: "aiModel.quickLabel", hintKey: "aiModel.quickDescription" },
  { section: "ai", labelKey: "aiModel.chatLabel", hintKey: "aiModel.chatDescription" },
  { section: "ai", labelKey: "aiInline.label", hintKey: "aiInline.description" },
  { section: "ai", labelKey: "aiKeys.title", hintKey: "aiKeys.description" },
  { section: "workspace", labelKey: "workspace.blocksTitle", hintKey: "workspace.blocksDescription" },
  { section: "workspace", labelKey: "workspace.statusTrackingTitle", hintKey: "workspace.statusTrackingDescription" },
  { section: "workspace", labelKey: "workspace.notificationsLabel" },
  { section: "workspace", labelKey: "workspace.autoResumeTitle", hintKey: "workspace.autoResumeDescription" },
  { section: "workspace", labelKey: "workspace.claudeFlagsLabel" },
  { section: "workspace", labelKey: "workspace.codexFlagsLabel" },
  { section: "workspace", labelKey: "workspace.prTitle", hintKey: "workspace.prDescription" },
  { section: "gitGraph", labelKey: "gitGraph.uncommittedTitle", hintKey: "gitGraph.uncommittedDescription" },
  { section: "gitGraph", labelKey: "gitGraph.refsTitle", hintKey: "gitGraph.refsDescription" },
  { section: "gitGraph", labelKey: "gitGraph.mergeLocalRemoteLabel", hintKey: "gitGraph.mergeLocalRemoteHint" },
  { section: "gitGraph", labelKey: "gitGraph.hideOriginHeadLabel", hintKey: "gitGraph.hideOriginHeadHint" },
  { section: "gitGraph", labelKey: "gitGraph.collapseLabel", hintKey: "gitGraph.collapseHint" },
  ...SHORTCUT_LABEL_KEYS.map((key) => ({
    section: "shortcuts" as const,
    labelKey: `shortcutsList.${key}`,
  })),
  { section: "about", labelKey: "update.check" },
  { section: "about", labelKey: "about.setupWizard" },
];

/**
 * The entries whose label or hint contains every word of `query`, in either
 * the interface language or English, so an English term finds a setting in
 * any interface language.
 */
export function searchSettings(
  query: string,
  t: TFunction,
  tEn: TFunction,
): SettingsSearchEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  return SETTINGS_SEARCH_INDEX.filter((entry) => {
    const keys = entry.hintKey ? [entry.labelKey, entry.hintKey] : [entry.labelKey];
    const text = keys
      .flatMap((key) => [t(key), tEn(key)])
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
