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
      wordWrap: initialState.wordWrap,
      workspaceCard: { status: true, branch: true, cwd: true, pr: true },
      prSource: "auto",
      claudeFlags: initialState.claudeFlags,
      codexFlags: initialState.codexFlags,
      customShellPath: initialState.customShellPath,
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

  it("defaults word wrap off and toggles it", () => {
    expect(useSettingsStore.getState().wordWrap).toBe(false);
    useSettingsStore.getState().toggleWordWrap();
    expect(useSettingsStore.getState().wordWrap).toBe(true);
    useSettingsStore.getState().toggleWordWrap();
    expect(useSettingsStore.getState().wordWrap).toBe(false);
  });

  it("persists wordWrap so it survives a reload", () => {
    useSettingsStore.getState().toggleWordWrap();
    const persisted = localStorage.getItem("tempoterm-settings");
    expect(persisted).toBeTruthy();
    expect(persisted).toContain('"wordWrap":true');
  });

  it("defaults the notes folder path to null and updates it", () => {
    expect(useSettingsStore.getState().notesFolderPath).toBeNull();
    useSettingsStore.getState().setNotesFolderPath("/Users/me/Notes");
    expect(useSettingsStore.getState().notesFolderPath).toBe("/Users/me/Notes");
    useSettingsStore.getState().setNotesFolderPath(null);
    expect(useSettingsStore.getState().notesFolderPath).toBeNull();
  });

  it("persists the notes folder path so it survives a reload", () => {
    useSettingsStore.getState().setNotesFolderPath("/Users/me/Notes");
    const persisted = localStorage.getItem("tempoterm-settings");
    expect(persisted).toContain("/Users/me/Notes");
  });

  it("defaults all workspace card blocks on and the PR source to auto", () => {
    expect(useSettingsStore.getState().workspaceCard).toEqual({
      status: true,
      branch: true,
      cwd: true,
      pr: true,
    });
    expect(useSettingsStore.getState().prSource).toBe("auto");
  });

  it("toggles a single workspace card block without touching the others", () => {
    useSettingsStore.getState().setWorkspaceCardBlock("pr", false);
    expect(useSettingsStore.getState().workspaceCard.pr).toBe(false);
    expect(useSettingsStore.getState().workspaceCard.status).toBe(true);
  });

  it("updates the PR source through setPrSource", () => {
    useSettingsStore.getState().setPrSource("token");
    expect(useSettingsStore.getState().prSource).toBe("token");
  });

  it("defaults aiTerminalContext on and toggles it", () => {
    expect(useSettingsStore.getState().aiTerminalContext).toBe(true);
    useSettingsStore.getState().setAiTerminalContext(false);
    expect(useSettingsStore.getState().aiTerminalContext).toBe(false);
  });

  it("defaults the launcher flags empty and updates them independently", () => {
    expect(useSettingsStore.getState().claudeFlags).toBe("");
    expect(useSettingsStore.getState().codexFlags).toBe("");
    useSettingsStore.getState().setClaudeFlags("--model opus");
    useSettingsStore.getState().setCodexFlags("--full-auto");
    expect(useSettingsStore.getState().claudeFlags).toBe("--model opus");
    expect(useSettingsStore.getState().codexFlags).toBe("--full-auto");
  });

  it("persists the launcher flags so they survive a reload", () => {
    useSettingsStore.getState().setClaudeFlags("--model opus");
    const persisted = localStorage.getItem("tempoterm-settings");
    expect(persisted).toContain("--model opus");
  });

  it("defaults the custom shell path empty and updates it", () => {
    expect(useSettingsStore.getState().customShellPath).toBe("");
    useSettingsStore.getState().setCustomShellPath("/opt/homebrew/bin/pwsh");
    expect(useSettingsStore.getState().customShellPath).toBe("/opt/homebrew/bin/pwsh");
  });

  it("defaults logging on with 30-day retention and updates via setters", () => {
    const s = useSettingsStore.getState();
    expect(s.loggingEnabled).toBe(true);
    expect(s.logRetentionDays).toBe(30);

    s.setLoggingEnabled(false);
    expect(useSettingsStore.getState().loggingEnabled).toBe(false);

    s.setLogRetentionDays(null);
    expect(useSettingsStore.getState().logRetentionDays).toBeNull();

    s.setLogRetentionDays(7);
    expect(useSettingsStore.getState().logRetentionDays).toBe(7);
  });
});
