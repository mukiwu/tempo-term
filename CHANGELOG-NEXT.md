## 正體中文

### feat

- AI 儀表板新增 Token 總量、快取命中率、工具呼叫次數、近 7 天用量與費用圖、Token 組成與常用工具排行，並可選今天或 7 天的範圍 (#471)
- 點選熱力圖上的某一天，可列出當天的對話 (#471)
- 滑鼠移到分頁列的 + 會滑出快速啟動列，可直接開啟終端機、資料夾、SSH、筆記、預覽或 Git Graph；從啟動器新增筆記時，側邊欄會切換到筆記區塊 (#473)
- ⌘T（Windows 為 Ctrl+T）直接開啟終端機分頁 (#474)
- 啟動器移除 Claude Code、Codex 與開啟檔案；Claude Code 與 Codex 參數移到設定中的接續對話選項下方 (#473)
- 移除 ⇧⌘T（Windows 為 Ctrl+Shift+T）快捷鍵，啟動器改由分頁列的 + 開啟 (#474)
- 分頁右鍵選單新增顏色、釘選、左右移動、關閉其他分頁與關閉右側分頁；釘選的分頁固定在最左側且不會被關閉 (#475)
- 新增指令面板（⌘P，Windows 為 Ctrl+P），可搜尋指令、檔案、AI 對話與 SSH 主機，指令也可用英文名稱搜尋；尋找檔案改為 ⌘⇧P（Windows 為 Ctrl+Shift+P）(#479)
- 分頁列右上角新增向右分割、向下分割與開啟指令面板的按鈕 (#479)
- 設定視窗新增搜尋，可用中文或英文找到設定項，點選後會跳到該項並短暫標示 (#481)
- 終端機設定新增選取後自動複製，以滑鼠選取文字後即複製到剪貼簿，預設關閉 (#483)
- 終端機設定新增新分頁的起始資料夾，可選工作區資料夾或目前終端機所在的資料夾 (#485)
- 關閉前確認改為從不、執行中時與一律三種模式，原本的開關設定會自動對應 (#487)
- 設定的快捷鍵頁可自訂 13 個常用指令的快捷鍵，點選後按下新按鍵即可變更，也可還原預設 (#489)

### fix

- Claude 的 Token 與費用不再重複計算同一則回覆的用量，成本估算也納入輸入與快取 Token (#471)
- AI 儀表板依各模型版本的官方價格估算費用，新增 OpenAI 與 Gemini 價格，Gemini 會依調價日期自動切換 (#477)
- Antigravity 對話可顯示模型、Token 用量與助理回覆 (#477)

### 貢獻者

## English

### feat

- Show total tokens, cache hit rate, tool calls, a 7-day usage and cost chart, token composition and top tools in the AI dashboard, with Today and 7-day ranges (#471)
- Select a day on the heatmap to list its sessions (#471)
- Hover the + in the tab bar to slide out a quick-launch strip for a terminal, folder, SSH, note, preview or Git Graph; creating a note from the launcher switches the sidebar to the notes panel (#473)
- ⌘T (Ctrl+T on Windows) opens a terminal tab directly (#474)
- Remove Claude Code, Codex and Open File from the launcher; the Claude Code and Codex flags move under the resume option in Settings (#473)
- Remove the ⇧⌘T (Ctrl+Shift+T on Windows) shortcut; open the launcher from the + in the tab bar (#474)
- Add color, pin, move left or right, close other tabs and close tabs to the right to the tab context menu; pinned tabs stay leftmost and cannot be closed (#475)
- Add a command palette (⌘P, Ctrl+P on Windows) that searches commands, files, AI sessions and SSH hosts, with commands also matched by their English names; Find Files moves to ⌘⇧P (Ctrl+Shift+P on Windows) (#479)
- Add Split Right, Split Down and Command Palette buttons to the right of the tab bar (#479)
- Search settings by name or description, in the interface language or English; choosing a result jumps to the setting and highlights it (#481)
- Add Copy on select to the terminal settings: a mouse selection is copied to the clipboard as soon as it ends, off by default (#483)
- Choose where new terminal tabs start in the terminal settings: the workspace folder or the directory of the terminal in front (#485)
- Close confirmation now offers Never, Running programs and Always; the previous on/off setting carries over (#487)
- Reassign the shortcuts of 13 common commands in Settings > Shortcuts: click one, press the new keys, or restore the default (#489)

### fix

- Stop counting the same Claude reply's usage more than once, and include input and cache tokens in the cost estimate (#471)
- Estimate AI dashboard costs from each model version's official price, add OpenAI and Gemini prices, and switch Gemini prices on their scheduled dates (#477)
- Show the model, token usage and assistant replies for Antigravity sessions (#477)

### Contributors
