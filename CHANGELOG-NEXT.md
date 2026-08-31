## 正體中文

### feat

- 檔案總管的右鍵選單新增「在瀏覽器開啟」，用內建的網頁預覽開啟檔案，不必先把它開進編輯器再按工具列那顆預覽鈕。開啟位置沿用既有的規則：分頁裡已經有預覽面板就換掉它的內容，單面板分頁就在旁邊分割，已經分割的分頁則使用專屬的預覽分頁。只有內建瀏覽器渲染得出來的檔案才會出現這個選項（HTML、SVG、PDF、圖片與影音），遠端 (SSH) 檔案則不適用 (#347)

### fix

- 修正 Windows 上開啟任何對話框時，自訂標題列右上角的最小化、最大化、關閉按鈕被遮罩蓋住而點不到的問題。三顆按鈕改為固定在視窗右上、永遠位於對話框之上；選單列維持被遮罩蓋住，避免隔著遮罩操作選單 (#349)
- 避免 macOS 在建立 PTY 的 fork 後子行程中掃描檔案描述符。這項非 async-signal-safe 操作依程式碼分析理論上可能造成崩潰，但目前實機測試未重現 (#355)
- 修正分頁開到超出視窗寬度時分頁列的一連串問題：Windows 上原本會冒出一根傳統捲軸吃掉列高、把每個分頁壓扁，現改為只在溢位時出現的 3px 細線（macOS 維持系統原生的覆蓋式捲軸）；滑鼠滾輪可橫向捲動分頁列，Shift＋滾輪逐格切換分頁並在兩端停住；新增分頁按鈕固定在最後一個分頁之後，不再跟著捲走；中鍵關閉分頁恢復可用；以快捷鍵切到畫面外的分頁時會自動捲入視野 (#350)
- 修正套用自訂背景圖時，橫向捲動編輯器或 diff 會讓程式碼從行號欄底下透出、與行號重疊的問題。行號欄改為自行繪製同一張桌布與相同色調，既能遮住底下的程式碼，也不會再出現 #342 修掉的深色直帶，而且完全不隨捲動重算 (#348)

### 貢獻者

- @mark22013333 (#355)
- @yw-chan (#348, #349, #350)
- @oberonlai (#347)

## English

### feat

- The explorer's context menu gains "Open in Browser", which opens a file in the built-in web preview instead of making you open it in the editor first and reach for the toolbar's preview button. Where it lands follows the existing rule: replace a preview pane the tab already has, split beside a single-pane tab, or use the dedicated preview tab when the tab is already split. The item only appears for files the built-in browser can actually render (HTML, SVG, PDF, images and media), and never for remote (SSH) files (#347)

### fix

- Fix the custom title bar's minimize, maximize and close controls on Windows being covered and made unclickable by any dialog's backdrop. The controls are now pinned to the window's top-right above every dialog, while the menu bar deliberately stays under the backdrop so a dialog cannot be operated from behind its own overlay (#349)
- Avoid scanning file descriptors in the post-fork macOS PTY child. Code analysis shows this non-async-signal-safe operation could theoretically crash, although hardware testing has not reproduced it (#355)
- Fix a run of problems with a tab strip that overflows the window. On Windows the classic scrollbar that appeared took height from the row and squashed every tab; it is replaced by a 3px hairline shown only while the tabs overflow (macOS keeps its native overlay scrollbar). The mouse wheel scrolls the strip sideways, Shift+wheel steps through the tabs one at a time and stops at either end, the add-tab button stays put after the last tab instead of scrolling away, middle-click-to-close works again, and activating an off-screen tab by shortcut scrolls it into view (#350)
- Fix code showing through the line-number gutter when the editor or diff view is scrolled horizontally with a custom background image set. The gutter now paints the same wallpaper and tint itself, so it hides the code beneath it without bringing back the darker stripe #342 removed, and nothing tracks the scroll position (#348)

### Contributors

- @mark22013333 (#355)
- @yw-chan (#348, #349, #350)
- @oberonlai (#347)
