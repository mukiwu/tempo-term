## 正體中文

### feat

- 全新統一選單列：macOS 與 Windows 改用同一套視窗內自繪的選單列（File／Edit／View／Terminal／Window／Help 共 32 個項目），跟隨主題與介面語言；macOS 原生選單縮到系統最小限度（App＋Edit），快捷鍵全數保留 (#173, #178)
- 首次啟動設定精靈：逐步引導安裝 Vibe Coding 需要的命令列工具（node、git、gh、claude、codex、antigravity），每個工具附用途說明、可安裝或略過；之後可從 File 選單或設定的關於分頁重新開啟 (#169)
- 側邊欄工具列圖示可拖曳排序：順序會保存，⌥＋數字鍵也跟著新順序切換面板 (#168)
- session 狀態燈全平台統一改走本機 loopback socket：Windows 因此首次支援 Claude Code／Codex 狀態追蹤，macOS 則淘汰舊的 `status-hook.sh` 注入（不再改寫 Claude Code 的 settings 檔），狀態訊息以每個分頁的 `pty id` 標記回對應面板 (#155, #177, #182)

### fix

- 修復 Windows 上多個快捷鍵完全無效的問題（關閉分頁、循環 pane、開新視窗、預覽網址列等），改由前端統一接手觸發 (#172)
- 修復 Windows 上 app 自動輸入的指令卡在 `>>` 續行提示不執行的問題（launcher 按鈕、對話 resume 按鈕等），注入指令改以 `CR` 送出 (#160)
- 修復 Windows 上狀態 hook 反覆彈出挑選應用程式對話框的問題，並自動清除舊版留下的設定 (#155, #176)
- git／gh 指令改為非同步執行：開啟原始碼控制面板、Git Graph 或刷新 PR 卡片時不再凍結整個視窗 (#165)
- 修正多終端同時大量輸出時的主執行緒卡頓：PTY 輸出合批送出、避免不必要的輪詢 (#159)
- 修正 icon font 設為自動偵測時，冷啟動後 Nerd Font 圖示變成方塊、要重選字型才恢復的問題 (#170)
- 修正 Windows 上網頁預覽面板比所在窗格小、右下出現 L 形白邊的問題：位置與尺寸改為單一原子呼叫更新，並補上漏註冊的命令 (#171, #175)
- 設定精靈改以正確的執行檔名稱 `agy` 偵測 Antigravity CLI，不再永遠顯示未安裝 (#174)
- 桌面通知的標籤跟隨使用者重新命名後的分頁名稱 (#158)
- 新增群組的預設名稱跟隨介面語言：中文顯示群組 1、群組 2，英文顯示 Group 1、Group 2 (#185)

### perf

- 歷史對話列表改用虛擬化渲染，累積上萬筆 session 時開啟面板不再卡頓數秒 (#167)

### 感謝

- 感謝 @oberonlai 貢獻首次啟動設定精靈、側邊欄圖示拖曳排序、歷史對話列表虛擬化、git／gh 指令非同步化與終端卡頓修正（#159, #165, #167, #168, #169）
- 感謝 @yw-chan 貢獻 Windows 上注入指令無法執行的修復（#160），以及 icon font 與網頁預覽兩個問題的精準回報（#163, #164）

## English

### feat

- Unified custom menu bar: macOS and Windows now share one self-drawn, in-window menu bar (File / Edit / View / Terminal / Window / Help, 32 items) that follows the app theme and UI language; the native macOS menu is reduced to the system minimum (App + Edit) and every shortcut still works (#173, #178)
- First-launch setup wizard: a step-by-step guide to install the CLI tools vibe coding needs (node, git, gh, claude, codex, antigravity), one tool at a time with a short description, install or skip each; reopen it later from the File menu or the About section in Settings (#169)
- Sidebar toolbar icons can be reordered by drag and drop: the order persists, and the ⌥+number shortcuts follow the new order (#168)
- Session status lights now use a local loopback socket on every platform: Windows gains Claude Code / Codex status tracking for the first time, and macOS retires the injected `status-hook.sh` (no more edits to your Claude Code settings file); messages are tagged with each pane's `pty id` so they light the right card (#155, #177, #182)

### fix

- Fix several shortcuts that did nothing on Windows (close tab, cycle pane, new window, preview address bar and more) by routing them through the frontend (#172)
- Fix app-injected commands stranding under a `>>` continuation prompt on Windows (launcher buttons, session resume and more) by submitting them with `CR` (#160)
- Stop the status hook from spamming the Windows "Open With" dialog, and clean up any entries an older build left behind (#155, #176)
- Run git / gh commands asynchronously so opening Source Control, Git Graph or refreshing PR cards no longer freezes the whole window (#165)
- Fix main-thread jank when many terminals stream heavy output at once: PTY output is batched and needless polling removed (#159)
- Fix Nerd Font icons rendering as tofu on a cold launch when the icon font is set to auto-detect (#170)
- Fix the preview pane rendering smaller than its pane on Windows with an L-shaped white gap: position and size now update in one atomic call, and a missing command registration is restored (#171, #175)
- The setup wizard now detects the Antigravity CLI by its real binary name `agy` instead of always reporting it as not installed (#174)
- Desktop notification labels follow a tab the user has renamed (#158)
- Newly created groups get a localized default name: 群組 1, 群組 2 in Traditional Chinese, Group 1, Group 2 in English (#185)

### perf

- The session history list is now virtualized, so opening the panel stays smooth even with tens of thousands of accumulated sessions (#167)

### Thanks

- Thanks to @oberonlai for contributing the first-launch setup wizard, draggable sidebar icon order, the virtualized session history list, async git / gh commands and the terminal jank fix (#159, #165, #167, #168, #169)
- Thanks to @yw-chan for contributing the fix for stranded injected commands on Windows (#160) and for the precise reports on the icon font and preview pane issues (#163, #164)
