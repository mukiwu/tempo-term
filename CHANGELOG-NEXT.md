## 正體中文

### feat

- AI 儀表板新增 Token 總量、快取命中率、工具呼叫次數、近 7 天用量與費用圖、Token 組成與常用工具排行，並可選今天或 7 天的範圍 (#471)
- 點選熱力圖上的某一天，可列出當天的對話 (#471)
- 滑鼠移到分頁列的 + 會滑出快速啟動列，可直接開啟終端機、資料夾、SSH、筆記、預覽或 Git Graph；從啟動器新增筆記時，側邊欄會切換到筆記區塊 (#473)
- ⌘T（Windows 為 Ctrl+T）直接開啟終端機分頁 (#474)
- 啟動器移除 Claude Code、Codex 與開啟檔案；Claude Code 與 Codex 參數移到設定中的接續對話選項下方 (#473)
- 移除 ⇧⌘T（Windows 為 Ctrl+Shift+T）快捷鍵，啟動器改由分頁列的 + 開啟 (#474)
- 分頁右鍵選單新增顏色、釘選、左右移動、關閉其他分頁與關閉右側分頁；釘選的分頁固定在最左側且不會被關閉 (#475)

### fix

- Claude 的 Token 與費用不再重複計算同一則回覆的用量，成本估算也納入輸入與快取 Token (#471)

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

### fix

- Stop counting the same Claude reply's usage more than once, and include input and cache tokens in the cost estimate (#471)

### Contributors
