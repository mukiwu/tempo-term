import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "./settingsStore";

const initialState = useSettingsStore.getState();

describe("settingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      language: initialState.language,
      theme: initialState.theme,
    });
  });

  it("defaults to English and the dark theme", () => {
    expect(useSettingsStore.getState().language).toBe("en");
    expect(useSettingsStore.getState().theme).toBe("dark");
  });

  it("updates the language through setLanguage", () => {
    useSettingsStore.getState().setLanguage("zh-Hant");
    expect(useSettingsStore.getState().language).toBe("zh-Hant");
  });

  it("updates the theme through setTheme", () => {
    useSettingsStore.getState().setTheme("light");
    expect(useSettingsStore.getState().theme).toBe("light");
  });

  it("persists the chosen language so it survives a reload", () => {
    useSettingsStore.getState().setLanguage("zh-Hant");
    const persisted = localStorage.getItem("tempoterm-settings");
    expect(persisted).toBeTruthy();
    expect(persisted).toContain("zh-Hant");
  });
});
