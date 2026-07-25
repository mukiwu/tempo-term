## 正體中文

### feat

- 終端機支援原生 OSC 8 檔案超連結：Claude Code 等 CLI 印出的檔案連結，按住修飾鍵點擊就能直接在編輯器分割窗開啟，長路徑因換行斷開也不受影響；會向 shell 宣告支援讓 CLI 改輸出原生連結，並擋下偽裝成本機檔案的 UNC 與遠端目標 (#243, #280)
- 版本控制面板的 Staged changes、Changes、Recent commits 三個區段可以收合：整條標題列都是點擊目標並支援鍵盤操作，Changes 收合時 Stage all 按鈕仍可直接使用，Recent commits 收合時會釘在面板底部 (#277, #282)
- 接續 AI 對話時可以帶上啟動器預設參數：AI 對話恢復新增子選項，開啟後啟動時自動接續與 AI Sessions 面板的一鍵接續都會附上對應 agent 的參數；AI 對話恢復對新安裝改為預設啟用，既有使用者維持原本的選擇；Codex 參數的範例提示同步更新，不再建議新版 CLI 已移除的 --full-auto (#289)

### fix

- 修正 git graph 裡分支尾端併回主線時，分支的線會蓋在主線上的問題：分支現在沿自己的軌道畫到底、貼著匯入的 commit 才彎進去，多條分支併進同一個 commit 也各走各的軌道 (#274)
- 修正 Windows 上工作目錄在網路共享（UNC 路徑）時終端機開錯位置的問題：cmd.exe 不支援 UNC 起始目錄會退回 C:\Windows，現在這種情況自動改用 PowerShell 啟動；有自訂 shell 設定時仍尊重使用者的選擇 (#284)
- 強化終端機連結的開檔安全：拒絕裝置與非一般檔案、單次讀取上限 10 MB 且改在背景執行緒跑（慢速磁碟或網路掛載不再凍住畫面），連結的懸浮提示會顯示解析後的真實目標，防止 OSC 8 連結文字偽裝；同時修正編輯器在檔案讀取失敗時誤存而把原檔清空的資料毀損風險 (#286)
- 修正 Windows 上 Codex hook 安裝失敗與 session 卡片誤顯示 Claude 圖示的問題：config.toml 編碼有問題（如 PowerShell 存成 UTF-16）不再擋住 hooks.json 升級且會給出明確錯誤，無法辨識來源的狀態回報改為清掉舊的 agent 標籤，設定頁開關失敗也會顯示原因而不是默默彈回 (#287)

## English

### feat

- The terminal now supports native OSC 8 file hyperlinks: file links printed by CLIs like Claude Code open directly in an editor split on modifier-click, unaffected by long paths wrapping across lines; the shell is told hyperlinks are supported so CLIs emit them, and UNC or remote targets disguised as local files are rejected (#243, #280)
- The source control panel's Staged changes, Changes and Recent commits sections are collapsible: the whole header row is the click target and works from the keyboard, Stage all stays usable while Changes is collapsed, and Recent commits pins to the bottom of the panel while collapsed (#277, #282)
- Resuming AI conversations can now carry the launcher default flags: a new sub-option under AI conversation recovery applies them to both startup auto-resume and the Sessions panel's one-click resume; AI conversation recovery is now enabled by default for fresh installs while existing users keep their choice, and the Codex flags placeholder no longer suggests --full-auto, which recent CLI versions removed (#289)

### fix

- Fix branch tails overdrawing the trunk in the git graph when merging back: a branch now runs down its own lane and only bends in right at its parent commit, and multiple branches joining the same commit each keep their own lane (#274)
- Fix terminals opening in the wrong place on Windows when the working directory is a network share (UNC path): cmd.exe rejects a UNC start directory and falls back to C:\Windows, so PowerShell is started instead in that case; a custom shell setting is still respected as-is (#284)
- Harden file opening from terminal links: devices and non-regular files are refused, reads are capped at 10 MB and run off the main thread (a slow disk or network mount no longer freezes the UI), and the link hover tooltip shows the resolved real target so OSC 8 link text cannot disguise it; also fixes a data-loss risk where saving after a failed read would truncate the original file (#286)
- Fix Codex hook install failures and session cards wearing the Claude icon on Windows: a config.toml encoding problem (e.g. UTF-16 from PowerShell) no longer blocks the hooks.json upgrade and reports a clear error, status reports that cannot name their agent now clear the stale label, and the settings toggle shows the failure reason instead of silently snapping back (#287)
