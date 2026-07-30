import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BACKGROUND_IMAGE_OPACITY,
  DEFAULT_TERMINAL_PADDING,
  MAX_BACKGROUND_IMAGE_OPACITY,
  MAX_TERMINAL_PADDING,
  MIN_BACKGROUND_IMAGE_OPACITY,
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
      backgroundImagePath: null,
      backgroundImageOpacity: DEFAULT_BACKGROUND_IMAGE_OPACITY,
      backgroundImageScope: "workspace",
      terminalPadding: initialState.terminalPadding,
      wordWrap: initialState.wordWrap,
      workspaceCard: { status: true, branch: true, cwd: true, pr: true },
      prSource: "auto",
      claudeFlags: initialState.claudeFlags,
      codexFlags: initialState.codexFlags,
      autoResumeAiSessions: initialState.autoResumeAiSessions,
      customShellPath: initialState.customShellPath,
    });
  });

  it("defaults to English and the default theme", () => {
    expect(useSettingsStore.getState().language).toBe("en");
    expect(useSettingsStore.getState().themeId).toBe(DEFAULT_THEME_ID);
  });

  it("stores an app-managed background image and clears it independently", () => {
    expect(useSettingsStore.getState().backgroundImagePath).toBeNull();
    useSettingsStore.getState().setBackgroundImage("/app-data/appearance/background.png");
    expect(useSettingsStore.getState().backgroundImagePath).toBe(
      "/app-data/appearance/background.png",
    );
    expect(localStorage.getItem("tempoterm-settings")).toContain("background.png");

    useSettingsStore.getState().clearBackgroundImage();
    expect(useSettingsStore.getState().backgroundImagePath).toBeNull();
  });

  it("defaults and clamps background image opacity to an integer percentage", () => {
    expect(useSettingsStore.getState().backgroundImageOpacity).toBe(
      DEFAULT_BACKGROUND_IMAGE_OPACITY,
    );
    useSettingsStore.getState().setBackgroundImageOpacity(1000);
    expect(useSettingsStore.getState().backgroundImageOpacity).toBe(
      MAX_BACKGROUND_IMAGE_OPACITY,
    );
    useSettingsStore.getState().setBackgroundImageOpacity(-4);
    expect(useSettingsStore.getState().backgroundImageOpacity).toBe(
      MIN_BACKGROUND_IMAGE_OPACITY,
    );
    useSettingsStore.getState().setBackgroundImageOpacity(42.6);
    expect(useSettingsStore.getState().backgroundImageOpacity).toBe(43);
    useSettingsStore.getState().setBackgroundImageOpacity(Number.NaN);
    expect(useSettingsStore.getState().backgroundImageOpacity).toBe(
      DEFAULT_BACKGROUND_IMAGE_OPACITY,
    );
  });

  it("switches and persists the background image scope", () => {
    expect(useSettingsStore.getState().backgroundImageScope).toBe("workspace");
    useSettingsStore.getState().setBackgroundImageScope("window");
    expect(useSettingsStore.getState().backgroundImageScope).toBe("window");
    expect(localStorage.getItem("tempoterm-settings")).toContain(
      '"backgroundImageScope":"window"',
    );
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

  it("defaults AI conversation recovery on and persists an opt-out", () => {
    // Opt-out since v0.3.2; persisted state from an earlier run still wins.
    expect(useSettingsStore.getState().autoResumeAiSessions).toBe(true);
    useSettingsStore.getState().setAutoResumeAiSessions(false);
    expect(useSettingsStore.getState().autoResumeAiSessions).toBe(false);
    expect(localStorage.getItem("tempoterm-settings")).toContain(
      '"autoResumeAiSessions":false',
    );
  });

  it("defaults resume-with-launcher-flags off and persists an opt-in", () => {
    expect(useSettingsStore.getState().resumeWithLauncherFlags).toBe(false);
    useSettingsStore.getState().setResumeWithLauncherFlags(true);
    expect(useSettingsStore.getState().resumeWithLauncherFlags).toBe(true);
    expect(localStorage.getItem("tempoterm-settings")).toContain(
      '"resumeWithLauncherFlags":true',
    );
  });

  it("defaults the custom shell path empty and updates it", () => {
    expect(useSettingsStore.getState().customShellPath).toBe("");
    useSettingsStore.getState().setCustomShellPath("/opt/homebrew/bin/pwsh");
    expect(useSettingsStore.getState().customShellPath).toBe("/opt/homebrew/bin/pwsh");
  });
});
