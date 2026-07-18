## 正體中文

### feat

- 安裝更新時顯示下載進度，不再只有轉圈等待 (#229)
- AI 對話清單新增專案下拉篩選：只列出實際出現過的專案，資料夾撞名時自動帶上上層目錄區分，CSV 匯出也同步套用目前的篩選條件 (#230)
- 初次設定精靈改透過你的 login shell 偵測 CLI，結果等同你在終端機看到的，nvm、自訂 npm prefix、bun、pnpm、獨立安裝器等安裝方式都能正確認得；找得到執行檔但讀不到版本時會標示為已安裝、版本未知，不再誤判成未安裝 (#238)

### fix

- 修正同一目錄同時跑多個 Claude session 時，工作區卡片標題互相覆蓋的問題：標題改以各 session 的 transcript 為準，ai-title 與 `/rename` 也會在 session 進行中即時更新 (#233)
- 修正 GUI 啟動時 PATH 過小導致 CLI 偵測與安裝失敗的問題：偵測與安裝子行程改帶完整搜尋路徑，macOS 的 Codex 安裝改用官方獨立安裝器（不再依賴 npm），子行程 PATH 並加固為只收絕對路徑 (#236, #237)

### 移除

- 移除側邊欄圖示上的 agent 狀態小圓點（0.2.0 加入的轉圈與脈動徽章）；工作區卡片與 worktree 列上的狀態顯示不受影響 (#240)

### 感謝

- 感謝 @dca 貢獻同目錄多 Claude session 的標題修正 (#233)
- 感謝 @Raymondhou0917 貢獻設定精靈的 PATH 修正與 Codex 官方安裝器 (#236)
- 感謝 @rollr76518 回報 Codex CLI 被誤判為未安裝的問題 (#232)

## English

### feat

- Show download progress while installing an update, instead of a bare spinner (#229)
- Sessions list gains a project filter dropdown: only projects that actually appear are listed, colliding folder names are disambiguated with their parent directory, and CSV export follows the active filters (#230)
- The first-run setup wizard now detects CLIs through your login shell, matching what your terminal sees, so nvm, custom npm prefixes, bun, pnpm, and standalone installers are all recognized; a binary that exists but will not report a version shows as installed with unknown version instead of missing (#238)

### fix

- Fix workspace card titles overwriting each other when several Claude sessions run in one directory: titles now follow each session's own transcript, and ai-titles / `/rename` refresh mid-session (#233)
- Fix CLI detection and installs failing under the GUI's minimal PATH: probe and install children now carry the full search path, Codex on macOS installs via OpenAI's standalone installer (no npm required), and child PATHs are hardened to absolute directories only (#236, #237)

### Removed

- Removed the agent-status dots on the sidebar strip icons (the spinning/pulsing badges added in 0.2.0); status indicators on workspace cards and worktree rows are unchanged (#240)

### Thanks

- The per-session workspace titles fix (#233) was contributed by @dca
- The setup PATH repair and the Codex standalone installer (#236) were contributed by @Raymondhou0917
- Thanks to @rollr76518 for reporting Codex CLI being misdetected as not installed (#232)
