import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_PADDING,
  MAX_TERMINAL_PADDING,
  MIN_TERMINAL_PADDING,
  useSettingsStore,
} from "./settingsStore";
import { DEFAULT_THEME_ID } from "@/themes/themes";

const initialState = useSettingsStore.getState();

describe("settingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      language: initialState.language,
      themeId: initialState.themeId,
      terminalPadding: initialState.terminalPadding,
    });
  });

  it("defaults to English and the default theme", () => {
    expect(useSettingsStore.getState().language).toBe("en");
    expect(useSettingsStore.getState().themeId).toBe(DEFAULT_THEME_ID);
  });

  it("defaults the terminal padding and clamps out-of-range values", () => {
    expect(useSettingsStore.getState().terminalPadding).toBe(DEFAULT_TERMINAL_PADDING);
    useSettingsStore.getState().setTerminalPadding(999);
    expect(useSettingsStore.getState().terminalPadding).toBe(MAX_TERMINAL_PADDING);
    useSettingsStore.getState().setTerminalPadding(-5);
    expect(useSettingsStore.getState().terminalPadding).toBe(MIN_TERMINAL_PADDING);
  });

  it("updates the language through setLanguage", () => {
    useSettingsStore.getState().setLanguage("zh-Hant");
    expect(useSettingsStore.getState().language).toBe("zh-Hant");
  });

  it("updates the theme through setThemeId", () => {
    useSettingsStore.getState().setThemeId("dracula");
    expect(useSettingsStore.getState().themeId).toBe("dracula");
  });

  it("persists the chosen language so it survives a reload", () => {
    useSettingsStore.getState().setLanguage("zh-Hant");
    const persisted = localStorage.getItem("tempoterm-settings");
    expect(persisted).toBeTruthy();
    expect(persisted).toContain("zh-Hant");
  });
});
