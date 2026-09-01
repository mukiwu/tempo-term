## 正體中文

### feat

- Source Control 面板的檔案列動作（加入、取消、放棄變更）改為滑過時展開，長路徑不再被常駐按鈕擠到截斷；區段與資料夾標題的動作維持常駐。目前開在前景的 diff 檔案會保持高亮並常駐動作列，part-staged 的檔案只標記實際開著的那一側；Staged changes 標題新增 Unstage all，與 Stage all 對等 (#364)
- Git Graph 的 branch 與 tag 標籤右鍵一律可複製名稱：還沒推上遠端的本地分支、目前所在的分支都有「複製分支名稱」，tag 則多了「複製標籤名稱」；先前只有帶遠端的標籤才能複製，在目前分支上按右鍵甚至是空選單 (#360)
- Git Graph 每列的 ref 標籤改依閱讀重要性排序：HEAD 所在的分支最前，接著本地分支、tag、沒有本地對應的遠端分支，唯讀裝飾最後；+N 收合的因此是最不重要的那些，合併標籤內的區塊也改以 origin 領先，不再跟著 git 的反向列舉順序 (#361)
- Git Graph 的 ref 標籤整併：同名的本地分支與其遠端摺成同一顆標籤、不再各佔一格，origin/HEAD 不再顯示，超出行寬上限的標籤收進 +N 清單，點開後每顆仍可右鍵操作；合併後的標籤右鍵選單同時帶本地與各遠端的操作，不必再記哪顆標籤管哪半邊 (#357)
- 檔案總管的右鍵選單新增「在瀏覽器開啟」，用內建的網頁預覽開啟檔案，不必先把它開進編輯器再按工具列那顆預覽鈕。開啟位置沿用既有的規則：分頁裡已經有預覽面板就換掉它的內容，單面板分頁就在旁邊分割，已經分割的分頁則使用專屬的預覽分頁。只有內建瀏覽器渲染得出來的檔案才會出現這個選項（HTML、SVG、PDF、圖片與影音），遠端 (SSH) 檔案則不適用 (#347)

### fix

- 修正 Windows 上開啟任何對話框時，自訂標題列右上角的最小化、最大化、關閉按鈕被遮罩蓋住而點不到的問題。三顆按鈕改為固定在視窗右上、永遠位於對話框之上；選單列維持被遮罩蓋住，避免隔著遮罩操作選單 (#349)
- 關閉仍有本機終端或 SSH 工作階段的視窗／App 前顯示可停用的原生確認提示，支援 macOS 與 Windows (#356)
- 避免 macOS 在建立 PTY 的 fork 後子行程中掃描檔案描述符。這項非 async-signal-safe 操作依程式碼分析理論上可能造成崩潰，但目前實機測試未重現 (#355)
- 修正分頁開到超出視窗寬度時分頁列的一連串問題：Windows 上原本會冒出一根傳統捲軸吃掉列高、把每個分頁壓扁，現改為只在溢位時出現的 3px 細線（macOS 維持系統原生的覆蓋式捲軸）；滑鼠滾輪可橫向捲動分頁列，Shift＋滾輪逐格切換分頁並在兩端停住；新增分頁按鈕固定在最後一個分頁之後，不再跟著捲走；中鍵關閉分頁恢復可用；以快捷鍵切到畫面外的分頁時會自動捲入視野 (#350)
- 修正套用自訂背景圖時，橫向捲動編輯器或 diff 會讓程式碼從行號欄底下透出、與行號重疊的問題。行號欄改為自行繪製同一張桌布與相同色調，既能遮住底下的程式碼，也不會再出現 #342 修掉的深色直帶，而且完全不隨捲動重算 (#348)

### 貢獻者

- @mark22013333 (#355, #356)
- @yw-chan (#348, #349, #350, #357, #360, #361, #364)
- @oberonlai (#347)

## English

### feat

- Source Control file-row actions (stage, unstage, discard) now reveal on hover, so long paths are no longer truncated against a permanent button gutter; section and folder header actions stay always visible. The file whose diff is in the foreground keeps its highlight and actions, a part-staged file is only marked on the side actually on screen, and the Staged changes header gains Unstage all as Stage all's counterpart (#364)
- Every branch and tag chip in the Git Graph can copy its name from the context menu: a local-only branch and the checked-out branch gain Copy branch name, and tags gain Copy tag name; previously only chips with a remote folded in offered it, and right-clicking the current branch showed nothing at all (#360)
- A commit row's ref chips are now ordered by what the row is read for: the checked-out branch first, then local branches, tags, remotes with no local twin, and read-only decorations last; the +N overflow therefore hides the least important chips, and origin leads the blocks inside a merged chip instead of following git's reversed enumeration order (#361)
- Git Graph ref chips are consolidated: a local branch and its same-named remotes fold into one chip instead of taking a slot each, origin/HEAD is no longer drawn, and chips past the row's limit collapse into a +N chip whose list keeps every chip right-clickable; a merged chip's context menu carries the local and each remote's operations, so there is no need to remember which chip owns which half (#357)
- The explorer's context menu gains "Open in Browser", which opens a file in the built-in web preview instead of making you open it in the editor first and reach for the toolbar's preview button. Where it lands follows the existing rule: replace a preview pane the tab already has, split beside a single-pane tab, or use the dedicated preview tab when the tab is already split. The item only appears for files the built-in browser can actually render (HTML, SVG, PDF, images and media), and never for remote (SSH) files (#347)

### fix

- Fix the custom title bar's minimize, maximize and close controls on Windows being covered and made unclickable by any dialog's backdrop. The controls are now pinned to the window's top-right above every dialog, while the menu bar deliberately stays under the backdrop so a dialog cannot be operated from behind its own overlay (#349)
- Add an optional native confirmation before closing a window or quitting the app with live terminal or SSH sessions on macOS and Windows (#356)
- Avoid scanning file descriptors in the post-fork macOS PTY child. Code analysis shows this non-async-signal-safe operation could theoretically crash, although hardware testing has not reproduced it (#355)
- Fix a run of problems with a tab strip that overflows the window. On Windows the classic scrollbar that appeared took height from the row and squashed every tab; it is replaced by a 3px hairline shown only while the tabs overflow (macOS keeps its native overlay scrollbar). The mouse wheel scrolls the strip sideways, Shift+wheel steps through the tabs one at a time and stops at either end, the add-tab button stays put after the last tab instead of scrolling away, middle-click-to-close works again, and activating an off-screen tab by shortcut scrolls it into view (#350)
- Fix code showing through the line-number gutter when the editor or diff view is scrolled horizontally with a custom background image set. The gutter now paints the same wallpaper and tint itself, so it hides the code beneath it without bringing back the darker stripe #342 removed, and nothing tracks the scroll position (#348)

### Contributors

- @mark22013333 (#355, #356)
- @yw-chan (#348, #349, #350, #357, #360, #361, #364)
- @oberonlai (#347)
