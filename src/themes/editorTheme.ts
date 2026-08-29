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
 * diff 變更行的底色會從行號底下滑過去，所以畫一層底把捲動的內容擋住。用
 * --color-editor-gutter-bg 而不是直接用 --color-bg：沒有背景圖時兩者同值，
 * 有背景圖時 --color-bg 是半透明的，編輯器外層已經塗過一層，gutter 再塗一層
 * 會疊成一條明顯更深的直帶，所以那個 token 在背景圖模式下會退回透明
 * （見 index.css 的 .wallpaper-surface）。那樣 gutter 就擋不住從底下滑過去的
 * 內容，所以背景圖模式改成讓 gutter 自己畫一份對齊的桌布，見 gutterWallpaper。
 */
const SURFACE = {
  background: "transparent",
  gutterBackground: "var(--color-editor-gutter-bg)",
} as const;

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
 * 背景圖模式下，gutter 自己畫一份和底下完全對齊的桌布。
 *
 * gutter 是 sticky 固定在左側的，橫向捲動時程式碼與 diff 變更行的底色會滑到
 * 行號底下。沒有背景圖時 gutter 有自己的不透明底色，擋得住；有背景圖時 #342
 * 把那層底色拿掉了（它會疊在編輯器外層的 tint 上，變成一條更深的直帶），內容
 * 就直接透出來和行號疊在一起。
 *
 * 補一層純色會把那條直帶帶回來，改用 JS 追 scrollLeft 去裁掉捲過去的內容則會
 * 抖——捲動是 compositor 在做的，JS 拿到 scroll 事件時畫面已經動過了。所以這裡
 * 讓 gutter 畫「桌布 + 同一層 tint」：不透明，擋得住內容，看起來又和旁邊一模
 * 一樣，而且完全靜態，沒有任何東西需要跟著捲動更新。
 *
 * 對齊靠 background-attachment: fixed（定位原點是 viewport，不受 gutter 自己
 * 被捲到哪影響）配上 BackgroundImageLayer 量好的尺寸與位置。沒有背景圖時
 * --cm-gutter-bg-image 沒有定義，整條規則就是 none，gutter 維持原本的底色。
 */
const gutterWallpaper: Extension = EditorView.theme({
  ".cm-gutters": {
    backgroundImage: "var(--cm-gutter-bg-image, none)",
    backgroundRepeat: "no-repeat",
    // 第一層是 tint，跟著 gutter 走；第二層是桌布，釘在 viewport 上。
    backgroundAttachment: "scroll, fixed",
    backgroundSize: "auto, var(--wallpaper-fixed-size, cover)",
    backgroundPosition: "0 0, var(--wallpaper-fixed-pos, center)",
  },
});

/**
 * 當前行高亮，外加「有選取時讓位」的行為。
 *
 * 這裡的 .cm-activeLine 規則並不會蓋過各主題套件自己的設定：CodeMirror 掛載
 * 樣式前會把 styleModule 反轉，排在前面的 extension 才勝出，而 activeLine 一律
 * 接在主題後面。兩邊的顏色都取自 LINE_HIGHLIGHT[id]，結果才會一致，所以這條
 * 規則實際的作用是替沒有自帶 activeLine 的主題墊底。
 *
 * 選取反白畫在內容層後面，不透明的行高亮會把它整行蓋住，所以有選取時隱藏
 * 行高亮（行號的高亮保留），選取取消才恢復。用 editorAttributes 掛 class（CM
 * 自己管理的屬性，不會像手動加在 view.dom 上那樣被洗掉）。透明那條規則帶 &
 * 前綴，產生的 selector 是 .生成class.cm-has-selection .cm-activeLine，特異度
 * 0,3,0 高於各套件的 0,2,0，所以它不靠掛載順序也贏。
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

const SYNTAX_THEMES: Record<string, Extension> = {
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

/** 語法主題配上所有主題共用的編輯器行為（目前是 gutter 的桌布層）。 */
const EDITOR_THEMES: Record<string, Extension> = Object.fromEntries(
  Object.entries(SYNTAX_THEMES).map(([id, syntax]) => [id, [gutterWallpaper, syntax]]),
);

/** 依 app 主題 id 挑選對應的編輯器語法高亮主題；未知 id 回退到預設主題。 */
export function editorSyntaxTheme(themeId: string): Extension {
  return EDITOR_THEMES[themeId] ?? EDITOR_THEMES[DEFAULT_THEME_ID];
}
