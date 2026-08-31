import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BACKGROUND_IMAGE_OPACITY,
  DEFAULT_TERMINAL_BACKGROUND_IMAGE_OPACITY,
  DEFAULT_GIT_GRAPH_REF_LIMIT,
  DEFAULT_TERMINAL_PADDING,
  MAX_BACKGROUND_IMAGE_OPACITY,
  MAX_GIT_GRAPH_REF_LIMIT,
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
      terminalBackgroundImageOpacity: DEFAULT_TERMINAL_BACKGROUND_IMAGE_OPACITY,
      backgroundImageScope: "workspace",
      backgroundImageTextColor: null,
      terminalPadding: initialState.terminalPadding,
      wordWrap: initialState.wordWrap,
      workspaceCard: { status: true, branch: true, cwd: true, pr: true },
      prSource: "auto",
      claudeFlags: initialState.claudeFlags,
      codexFlags: initialState.codexFlags,
      autoResumeAiSessions: initialState.autoResumeAiSessions,
      customShellPath: initialState.customShellPath,
      gitGraphRefs: initialState.gitGraphRefs,
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

  it("stores a separately clamped terminal background image opacity", () => {
    expect(useSettingsStore.getState().terminalBackgroundImageOpacity).toBe(
      DEFAULT_TERMINAL_BACKGROUND_IMAGE_OPACITY,
    );
    useSettingsStore.getState().setTerminalBackgroundImageOpacity(62.8);
    expect(useSettingsStore.getState().terminalBackgroundImageOpacity).toBe(63);
    expect(localStorage.getItem("tempoterm-settings")).toContain(
      '"terminalBackgroundImageOpacity":63',
    );
    useSettingsStore.getState().setTerminalBackgroundImageOpacity(-10);
    expect(useSettingsStore.getState().terminalBackgroundImageOpacity).toBe(0);
  });

  it("switches and persists the background image scope", () => {
    expect(useSettingsStore.getState().backgroundImageScope).toBe("workspace");
    useSettingsStore.getState().setBackgroundImageScope("window");
    expect(useSettingsStore.getState().backgroundImageScope).toBe("window");
    expect(localStorage.getItem("tempoterm-settings")).toContain(
      '"backgroundImageScope":"window"',
    );
  });

  it("stores only a safe six-digit background text colour", () => {
    useSettingsStore.getState().setBackgroundImageTextColor("#F4F7FF");
    expect(useSettingsStore.getState().backgroundImageTextColor).toBe("#f4f7ff");
    expect(localStorage.getItem("tempoterm-settings")).toContain("#f4f7ff");

    useSettingsStore.getState().setBackgroundImageTextColor("var(--danger)");
    expect(useSettingsStore.getState().backgroundImageTextColor).toBeNull();
  });

  it("normalizes corrupted persisted background settings during hydration", async () => {
    localStorage.setItem(
      "tempoterm-settings",
      JSON.stringify({
        state: {
          backgroundImagePath: 42,
          backgroundImageOpacity: 900,
          terminalBackgroundImageOpacity: "invalid",
          backgroundImageScope: "outside",
          backgroundImageTextColor: "var(--danger)",
        },
        version: 0,
      }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState()).toMatchObject({
      backgroundImagePath: null,
      backgroundImageOpacity: MAX_BACKGROUND_IMAGE_OPACITY,
      terminalBackgroundImageOpacity: DEFAULT_TERMINAL_BACKGROUND_IMAGE_OPACITY,
      backgroundImageScope: "workspace",
      backgroundImageTextColor: null,
    });
  });

  it("defaults every Git Graph ref option on, collapsing past three chips", () => {
    expect(useSettingsStore.getState().gitGraphRefs).toEqual({
      mergeLocalRemote: true,
      hideOriginHead: true,
      collapseExtraRefs: true,
      refLimit: DEFAULT_GIT_GRAPH_REF_LIMIT,
    });
  });

  it("patches one Git Graph ref option without touching the others", () => {
    useSettingsStore.getState().setGitGraphRefs({ hideOriginHead: false });
    expect(useSettingsStore.getState().gitGraphRefs).toMatchObject({
      hideOriginHead: false,
      mergeLocalRemote: true,
      collapseExtraRefs: true,
    });
  });

  it("clamps the ref limit so a stray value cannot hide every chip behind +N", () => {
    useSettingsStore.getState().setGitGraphRefs({ refLimit: 99 });
    expect(useSettingsStore.getState().gitGraphRefs.refLimit).toBe(MAX_GIT_GRAPH_REF_LIMIT);
    useSettingsStore.getState().setGitGraphRefs({ refLimit: 0 });
    expect(useSettingsStore.getState().gitGraphRefs.refLimit).toBe(1);
  });

  it("fills in the Git Graph ref block a store written by an older build lacks", async () => {
    localStorage.setItem(
      "tempoterm-settings",
      JSON.stringify({ state: { language: "en" }, version: 0 }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().gitGraphRefs).toEqual({
      mergeLocalRemote: true,
      hideOriginHead: true,
      collapseExtraRefs: true,
      refLimit: DEFAULT_GIT_GRAPH_REF_LIMIT,
    });
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
