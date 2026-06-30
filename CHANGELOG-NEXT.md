## 正體中文

### feat
- 網頁預覽改用系統原生 webview：之前用 iframe，像 wp-admin 這類設了防嵌入規則的後台會一片空白，現在改用系統原生的 webview 疊在面板上，不受那些規則限制，後台和需要登入的站台都能正常顯示
- 終端機 session 狀態通知：終端機裡跑的工作（含 Claude Code、Codex）狀態有變化時會發系統通知，切到別的視窗也不會漏掉
- 啟動器新增 Claude Code 與 Codex 選項：開新終端機的啟動器可以直接挑 Claude Code 或 Codex 啟動，不用自己打指令
- 可自訂 icon 字體：設定裡多了一個 icon 字體欄位，當主字體缺某些圖示字符時，用你指定的字體補上

### fix
- 網頁預覽的網址列：在預覽裡跳轉到新網址後，分頁標題會跟著換成新網站，不再卡在一開始那個網址；另外只打網域沒帶 http 的網址（例如 google.com.tw）現在會自動補上 scheme，打得開了
- 終端機改用 DOM 算繪取代 WebGL：徹底解決長時間使用後中文字變亂碼的問題，不用再手動切字體
- Windows 上即使 `gh` 已安裝且在 PATH，仍顯示找不到 gh CLI 的問題已修：偵測時會解析 `gh.exe` 並涵蓋 Windows 常見安裝路徑
- 切換分頁時檔案總管會跟著切到該分頁的工作目錄
- 切換側邊欄到工作區面板時的短暫卡頓已修
- 側邊欄的右鍵選單和主分頁列統一，行為一致
- 焦點外框從系統預設的白框改成主題的 accent 色
- ⌘W 改成關掉目前焦點所在的面板，而不是固定關右下角那個

### 移除
- 移除 Logs 記錄面板：0.0.11 加的這個面板（自動把每個終端機 session 輸出存成檔案）這版先拿掉了，連同設定裡的開關，把側邊欄收斂回更精簡的核心，之後若有更輕量的做法再考慮

### 感謝
- 網頁預覽改用原生 webview（#97）、終端機改用 DOM 算繪（#98）、切換分頁時檔案總管同步目錄（#83）由 @oberonlai 貢獻
- Windows 上偵測不到 gh CLI 的修正（#89）由 @j7-dev 貢獻

## English

### feat
- Web preview now uses a native webview: it used an iframe before, so pages with anti-embedding rules (such as wp-admin) showed up blank. A native webview composited over the panel ignores those rules, so admin panels and login-gated sites display correctly
- Terminal session status notifications: when a job running in a terminal (including Claude Code / Codex) changes state, you get a system notification, so you won't miss it after switching windows
- Launcher adds Claude Code and Codex: the new-terminal launcher can start Claude Code or Codex directly, with no need to type the command
- Configurable icon font: settings add an icon-font slot that fills in glyphs your main font is missing

### fix
- Web preview address bar: after navigating to a new url the tab title follows the new site instead of staying on the initial url; and a bare host without a scheme (such as google.com.tw) now gets one added automatically so it loads
- Terminal switched from WebGL to a DOM renderer, which fully fixes CJK text turning into garbled glyphs after a long session, with no need to switch fonts by hand
- Fixed gh CLI not being detected on Windows even when `gh` is installed and on PATH: detection now resolves `gh.exe` and covers the common Windows install locations
- The file explorer now follows the active tab's working directory when you switch tabs
- Fixed a brief freeze when switching the sidebar to the Workspaces panel
- The sidebar's right-click menu now matches the main tab bar, so they behave the same
- The focus ring changed from the OS default white outline to the theme accent color
- ⌘W now closes the focused panel instead of always the bottom-right one

### Removed
- Removed the Logs panel: the panel added in 0.0.11 (recording each terminal session's output to a file) is gone this release, along with its settings toggle, trimming the sidebar back to a leaner core to revisit with a lighter approach later

### Thanks
- The native-webview preview (#97), the DOM terminal renderer (#98), and the file-explorer directory sync (#83) were contributed by @oberonlai
- The fix for gh CLI not being detected on Windows (#89) was contributed by @j7-dev
