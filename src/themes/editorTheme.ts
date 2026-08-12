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
 * 所有主題都把編輯器自身背景與 gutter 設為透明，沿用底下 app 的背景（bg-bg），
 * 不自己畫一塊底色，這樣切到任何主題都不會出現色塊斷層。「當前行高亮」統一用
 * 各主題的 bg-elevated，讓游標所在行融入 app 的明暗階層。
 */
const TRANSPARENT = { background: "transparent", gutterBackground: "transparent" } as const;

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

/**
 * 統一的當前行高亮 wrapper，不論底層套件是否自己處理 .cm-activeLine 都生效。
 *
 * 選取反白畫在內容層後面，不透明的行高亮會把它整行蓋住，所以有選取時隱藏
 * 行高亮（行號的高亮保留），選取取消才恢復。用
 * editorAttributes 掛 class（CM 自己管理的屬性，不會像手動加在 view.dom 上
 * 那樣被洗掉）；透明規則的 selector 特異度高於各主題套件自己的 activeLine
 * 規則，不受主題掛載順序影響。
 */
function activeLine(color: string): Extension {
  return [
    EditorView.editorAttributes.compute(["selection"], (state) => ({
      class: state.selection.ranges.some((range) => !range.empty) ? "cm-has-selection" : "",
    })),
    EditorView.theme({
      ".cm-activeLine": { backgroundColor: color },
      ".cm-activeLineGutter": { backgroundColor: color },
      "&.cm-has-selection .cm-activeLine": { backgroundColor: "transparent" },
    }),
  ];
}

const vitesseDarkEditor: Extension = [
  createVitesseDarkTheme({
    settings: { ...defaultSettingsVitesseDark, ...TRANSPARENT, lineHighlight: LINE_HIGHLIGHT["vitesse-dark"] },
  }),
  activeLine(LINE_HIGHLIGHT["vitesse-dark"]),
];

const vitesseLightEditor: Extension = [
  createVitesseLightTheme({
    settings: { ...defaultSettingsVitesseLight, ...TRANSPARENT, lineHighlight: LINE_HIGHLIGHT["vitesse-light"] },
  }),
  activeLine(LINE_HIGHLIGHT["vitesse-light"]),
];

const githubDarkEditor: Extension = [
  githubDarkInit({
    settings: { ...defaultSettingsGithubDark, ...TRANSPARENT, lineHighlight: LINE_HIGHLIGHT["github-dark"] },
  }),
  activeLine(LINE_HIGHLIGHT["github-dark"]),
];

const githubLightEditor: Extension = [
  githubLightInit({
    settings: { ...defaultSettingsGithubLight, ...TRANSPARENT, lineHighlight: LINE_HIGHLIGHT["github-light"] },
  }),
  activeLine(LINE_HIGHLIGHT["github-light"]),
];

const draculaEditor: Extension = [
  draculaInit({
    settings: { ...defaultSettingsDracula, ...TRANSPARENT, lineHighlight: LINE_HIGHLIGHT["dracula"] },
  }),
  activeLine(LINE_HIGHLIGHT["dracula"]),
];

const gruvboxDarkEditor: Extension = [
  gruvboxDarkInit({
    settings: { ...defaultSettingsGruvboxDark, ...TRANSPARENT, lineHighlight: LINE_HIGHLIGHT["gruvbox-dark"] },
  }),
  activeLine(LINE_HIGHLIGHT["gruvbox-dark"]),
];

const solarizedLightEditor: Extension = [
  solarizedLightInit({
    settings: { ...defaultSettingsSolarizedLight, ...TRANSPARENT, lineHighlight: LINE_HIGHLIGHT["solarized-light"] },
  }),
  activeLine(LINE_HIGHLIGHT["solarized-light"]),
];

// 官方 oneDark 自帶 #282c34 背景，疊一層透明覆蓋讓它沿用 app 背景。
const oneDarkEditor: Extension = [
  oneDark,
  EditorView.theme({
    "&": { backgroundColor: "transparent" },
    ".cm-gutters": { backgroundColor: "transparent" },
  }),
  activeLine(LINE_HIGHLIGHT["one-dark"]),
];

// One Light 沒有維護中的 CM6 套件，依 akamud One Light 官方 token 配色手刻。
const oneLightEditor: Extension = [
  createTheme({
    theme: "light",
    settings: {
      ...TRANSPARENT,
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
