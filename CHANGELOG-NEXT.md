## 正體中文

### feat
- AI 對話瀏覽：在側邊欄的獨立分頁裡瀏覽 Claude Code、Codex 與 Antigravity CLI 的所有歷史對話，直接讀本機的 session 檔案，不會複製進 TempoTerm 自己的資料庫
- 對話儀表板：全期間活動熱圖（可切換訊息／對話數／token）、今日時段分布、model 使用量圓餅圖、各 agent 的本週統計、熱門對話，以及以美金估算的成本
- 專案視角：從任一對話的專案名進入，看該專案的累積統計、最近對話，並一鍵在該目錄開新終端
- Session 對應 git commit：在對話內文下方列出這次對話期間該專案產生的本機 commit
- 對話管理與匯出：依 agent 或 model 篩選清單，釘選、刪除到垃圾桶，把內文匯出成 Markdown，或把篩選後的清單匯出成 CSV

### fix
- 開新終端會正確切換到指定目錄，原本會被檔案總管的根目錄覆蓋

## English

### feat
- AI Sessions browser: browse every past Claude Code, Codex and Antigravity CLI conversation in a dedicated sidebar tab, read directly from the local session files so nothing is copied into TempoTerm's own storage
- Sessions dashboard: a full-range activity heatmap (toggle messages / sessions / tokens), today's hour-of-day distribution, model usage as a share donut, a per-agent weekly breakdown, top conversations, and an estimated cost in USD
- Project view: open it from any conversation's project name to see that project's aggregate stats, recent sessions, and a one-click terminal rooted at its directory
- Session to git commit correlation: the transcript lists the local git commits made in that project during the session
- Manage and export: filter the list by agent or model, pin, delete to trash, export a transcript to Markdown, or export the filtered list to CSV

### fix
- Opening a new terminal now changes directory to the requested path instead of being overridden by the file explorer's root
