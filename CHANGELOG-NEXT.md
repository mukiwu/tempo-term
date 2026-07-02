## 正體中文

### feat

- 「工作空間」更名為「群組」，側欄面板與設定分頁同步更名；原「關閉工作區」按鈕依實際功能更名為「關閉資料夾」
- 側邊欄（檔案總管、筆記、SSH 連線）單擊會直接分割進目前分頁；新增右鍵選單可選「在新分頁開啟」或「分割成新窗格」；拖曳項目到窗格上會依放開位置分割到對應方向並顯示插入線提示，拖到分頁列可直接開新分頁；窗格會自動排進固定 4 欄、最多 8 格的版面
- 網頁預覽分頁標題改為跟隨網頁實際的 Title；新增「上一頁／下一頁」按鈕，並可用 ⌘[ 與 ⌘] 切換；新增 ⌘L 快速跳到網址列。

### fix

- 修正 ⌘W 有時會直接關掉整個視窗，而不是關掉目前分頁或窗格的問題
- ⌘W（關閉分頁）與 ⌘\`（切換窗格）原本在焦點停留於網頁預覽窗格時會失效，改用選單快捷鍵觸發，不再受影響
- 修正 Windows 下呼叫 gh 時會閃現主控台視窗、偶爾卡住畫面的問題，並跳過原本在 Windows 上就沒作用的終端機工作目錄輪詢
- 切換到含終端機的分頁時，鍵盤焦點現在會自動回到終端機輸入，不用再手動點一下

## English

### feat

- Renamed "spaces"/"workspaces" to "groups" across the sidebar panel and settings; the "Close workspace" button is now "Close folder" to match what it actually does
- Sidebar items (Explorer, Notes, SSH connections) now split into the active tab on a single click; added a right-click menu to open in a new tab or split into a pane; dragging an item onto a pane splits it toward wherever you drop, with an insertion-line indicator, and dragging onto the tab bar opens a new tab; panes now auto-arrange into a fixed 4-column, 8-pane grid
- Web preview tab titles now follow the page's real `<title>`; added Back/Forward buttons (⌘[ and ⌘]) and ⌘L to jump to the address bar.

### fix

- Fixed ⌘W sometimes closing the entire window instead of just the focused pane or tab
- Fixed ⌘W (Close Tab) and ⌘` (Cycle Pane) not working while a web preview pane held keyboard focus, by driving them from native menu shortcuts instead
- Fixed `gh` calls flashing a console window and occasionally stalling the UI on Windows, and stopped a terminal cwd poll that never did anything there anyway
- Terminal panes now regain keyboard focus automatically when you switch to their tab, instead of needing an extra click
