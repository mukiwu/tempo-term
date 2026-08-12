import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createVitesseDarkTheme,
  createVitesseLightTheme,
  defaultSettingsVitesseDark,
  defaultSettingsVitesseLight,
} from "codemirror-theme-vitesse";
import {
  defaultSettingsGithubDark,
  defaultSettingsGithubLight,
  githubDarkInit,
  githubLightInit,
} from "@uiw/codemirror-theme-github";
import { defaultSettingsDracula, draculaInit } from "@uiw/codemirror-theme-dracula";
import { defaultSettingsGruvboxDark, gruvboxDarkInit } from "@uiw/codemirror-theme-gruvbox-dark";
import { defaultSettingsSolarizedLight, solarizedLightInit } from "@uiw/codemirror-theme-solarized";
import { createTheme } from "@uiw/codemirror-themes";
import { oneDark } from "@codemirror/theme-one-dark";
import { tags as t } from "@lezer/highlight";
import { DEFAULT_THEME_ID } from "./themes";

/**
 * CodeMirror 語法高亮主題，逐一對齊每個 app 主題的官方配色。
 *
 * 語法配色來源：vitesse 用 codemirror-theme-vitesse；github / dracula /
 * gruvbox / solarized 用對應的 @uiw/codemirror-theme-* 套件；one-dark 用官方
 * @codemirror/theme-one-dark；one-light 無現成套件，依 akamud One Light 官方
 * 配色手刻。
 *
 * 所有主題都把編輯器自身背景設為透明，沿用底下 app 的背景（bg-bg），
 * 不自己畫一塊底色，這樣切到任何主題都不會出現色塊斷層。「當前行高亮」統一用
 * 各主題的 bg-elevated，讓游標所在行融入 app 的明暗階層。
 *
 * 行號 gutter 例外：它在橫向捲動時是 sticky 固定在左側的，若透明，程式碼與
 * diff 變更行的底色會從行號底下滑過去，所以改用 app 背景 token 畫一層不透明
 * 底——顏色與透明時完全相同，只是擋住底下捲動的內容。
 */
const SURFACE = { background: "transparent", gutterBackground: "var(--color-bg)" } as const;

/** 各主題的當前行高亮色（= themes.ts 的 bgElevated）。 */
const LINE_HIGHLIGHT: Record<string, string> = {
  "vitesse-dark": "#292929",
  "vitesse-light": "#f7f7f7",
  "github-dark": "#161b22",
  "github-light": "#f6f8fa",
  "one-dark": "#2c313a",
  "one-light": "#f0f0f0",
  dracula: "#343746",
  "gruvbox-dark": "#32302f",
  "solarized-light": "#eee8d5",
};

/** 統一的當前行高亮 wrapper，不論底層套件是否自己處理 .cm-activeLine 都生效。 */
function activeLine(color: string): Extension {
  return EditorView.theme({
    ".cm-activeLine": { backgroundColor: color },
    ".cm-activeLineGutter": { backgroundColor: color },
  });
}

const vitesseDarkEditor: Extension = [
  createVitesseDarkTheme({
    settings: { ...defaultSettingsVitesseDark, ...SURFACE, lineHighlight: LINE_HIGHLIGHT["vitesse-dark"] },
  }),
  activeLine(LINE_HIGHLIGHT["vitesse-dark"]),
];

const vitesseLightEditor: Extension = [
  createVitesseLightTheme({
    settings: { ...defaultSettingsVitesseLight, ...SURFACE, lineHighlight: LINE_HIGHLIGHT["vitesse-light"] },
  }),
  activeLine(LINE_HIGHLIGHT["vitesse-light"]),
];

const githubDarkEditor: Extension = [
  githubDarkInit({
    settings: { ...defaultSettingsGithubDark, ...SURFACE, lineHighlight: LINE_HIGHLIGHT["github-dark"] },
  }),
  activeLine(LINE_HIGHLIGHT["github-dark"]),
];

const githubLightEditor: Extension = [
  githubLightInit({
    settings: { ...defaultSettingsGithubLight, ...SURFACE, lineHighlight: LINE_HIGHLIGHT["github-light"] },
  }),
  activeLine(LINE_HIGHLIGHT["github-light"]),
];

const draculaEditor: Extension = [
  draculaInit({
    settings: { ...defaultSettingsDracula, ...SURFACE, lineHighlight: LINE_HIGHLIGHT["dracula"] },
  }),
  activeLine(LINE_HIGHLIGHT["dracula"]),
];

const gruvboxDarkEditor: Extension = [
  gruvboxDarkInit({
    settings: { ...defaultSettingsGruvboxDark, ...SURFACE, lineHighlight: LINE_HIGHLIGHT["gruvbox-dark"] },
  }),
  activeLine(LINE_HIGHLIGHT["gruvbox-dark"]),
];

const solarizedLightEditor: Extension = [
  solarizedLightInit({
    settings: { ...defaultSettingsSolarizedLight, ...SURFACE, lineHighlight: LINE_HIGHLIGHT["solarized-light"] },
  }),
  activeLine(LINE_HIGHLIGHT["solarized-light"]),
];

// 官方 oneDark 自帶 #282c34 背景，疊一層覆蓋讓它沿用 app 背景。CodeMirror
// mount 主題樣式時「排前面的 extension 優先」（facet 反轉後掛載），覆蓋層
// 必須放在 oneDark 前面才蓋得過去。
const oneDarkEditor: Extension = [
  EditorView.theme({
    "&": { backgroundColor: "transparent" },
    ".cm-gutters": { backgroundColor: SURFACE.gutterBackground },
  }),
  activeLine(LINE_HIGHLIGHT["one-dark"]),
  oneDark,
];

// One Light 沒有維護中的 CM6 套件，依 akamud One Light 官方 token 配色手刻。
const oneLightEditor: Extension = [
  createTheme({
    theme: "light",
    settings: {
      ...SURFACE,
      foreground: "#383a42",
      caret: "#526fff",
      selection: "#e5e5e6",
      selectionMatch: "#e5e5e6",
      gutterForeground: "#9d9d9f",
      lineHighlight: LINE_HIGHLIGHT["one-light"],
    },
    styles: [
      { tag: t.comment, color: "#a0a1a7", fontStyle: "italic" },
      {
        tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.moduleKeyword, t.definitionKeyword],
        color: "#a626a4",
      },
      { tag: [t.string, t.special(t.string), t.regexp], color: "#50a14f" },
      { tag: [t.number, t.bool, t.null, t.atom], color: "#986801" },
      { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#4078f2" },
      { tag: [t.className, t.typeName, t.definition(t.typeName)], color: "#c18401" },
      { tag: [t.tagName, t.standard(t.tagName)], color: "#e45649" },
      { tag: [t.propertyName, t.attributeName], color: "#4078f2" },
      { tag: [t.variableName, t.definition(t.variableName)], color: "#e45649" },
      { tag: [t.operator, t.punctuation, t.bracket], color: "#383a42" },
      { tag: [t.constant(t.variableName)], color: "#986801" },
      { tag: t.heading, color: "#e45649", fontWeight: "bold" },
      { tag: [t.link, t.url], color: "#0184bc" },
    ],
  }),
  activeLine(LINE_HIGHLIGHT["one-light"]),
];

const EDITOR_THEMES: Record<string, Extension> = {
  "vitesse-dark": vitesseDarkEditor,
  "vitesse-light": vitesseLightEditor,
  "github-dark": githubDarkEditor,
  "github-light": githubLightEditor,
  "one-dark": oneDarkEditor,
  "one-light": oneLightEditor,
  dracula: draculaEditor,
  "gruvbox-dark": gruvboxDarkEditor,
  "solarized-light": solarizedLightEditor,
};

/** 依 app 主題 id 挑選對應的編輯器語法高亮主題；未知 id 回退到預設主題。 */
export function editorSyntaxTheme(themeId: string): Extension {
  return EDITOR_THEMES[themeId] ?? EDITOR_THEMES[DEFAULT_THEME_ID];
}
