## 正體中文

### feat

- 工作區側邊欄卡片會標示 AI CLI 的 logo：偵測到 Claude 或 Codex session 時，在目錄前顯示對應圖示，取代原本的文字標籤 (#250)
- 分割面板的側邊欄卡片改為每個面板一個區塊：各自顯示資料夾名稱、AI logo 與 session 名稱、狀態徽章、分支、目錄與 PR，聚焦中的面板以強調色標示標題，區塊之間加上分隔線，切換面板不再改變卡片顯示的目錄 (#250)
- 側邊欄卡片的目錄路徑改以 `~` 縮寫家目錄，Windows 磁碟機路徑維持原樣 (#250)
- 側邊欄的分頁卡片、群組名稱與 session 名稱被截斷時，滑鼠移到卡片任一處會以提示框顯示完整名稱，未截斷時不會出現 (#248)
- 分頁列的使用中分頁改用新樣式：分頁撐滿分頁列並貼齊底部框線，以強調色底線加上 10% 透明度的同色背景標示，取代原本的圓點 (#252)
- Diff 分頁可以留評論給 AI agent：滑到某一行點行號左側的 +，在該行下方留下評論；按標頭的紙飛機按鈕，所有評論會按檔案分組、附上行號與程式碼，一次貼進正在執行 Claude 或 Codex 的終端機面板，內容先落在輸入框、確認後才送出；送過的評論會標示已送出並保留供驗收，檔案重新載入時評論依行內容自動跟到新位置，第一次打開 diff 分頁會顯示一次性操作指引 (#254)

### fix

- 修正側邊欄群組的收合開關：整列（含箭頭與資料夾圖示）都可以點擊，且收合、展開不再把畫面切到該群組的分頁 (#249)

## English

### feat

- Workspace sidebar cards now show the AI CLI's logomark: when a Claude or Codex session is detected, its icon appears before the directory, replacing the old text labels (#250)
- Split-pane sidebar cards now render one block per pane — each with its own folder name, AI logomark and session title, status badge, branch, directory, and PR; the focused pane's title is accented, blocks are separated by a divider, and switching panes no longer changes the directory the card shows (#250)
- Directory paths on sidebar cards abbreviate the home prefix to `~`; Windows drive paths are untouched (#250)
- Hovering anywhere on a sidebar card reveals the full tab, group, or session name in a tooltip when it is truncated, and stays quiet when it is not (#248)
- The active tab in the tab bar gets a new look: the tab stretches flush to the bar's bottom border and is marked by an accent underline plus a 10% accent background fill, replacing the leading dot (#252)
- Diff tabs now take review comments for AI agents: hover a line and click the + left of its line number to comment under it. The paper-plane button in the header batch-sends every comment — grouped by file with line numbers and code anchors — into a terminal pane running Claude or Codex; the prompt lands in the input box for confirmation before sending. Sent comments stay visible (marked "Sent") for verification, comments re-anchor by line content when the file reloads, and a one-time hint introduces the flow on the first diff tab (#254)

### fix

- Fix the workspace group collapse toggle: the whole header row (including the chevron and folder icons) is now clickable, and collapsing or expanding no longer switches the view to that group's tab (#249)
