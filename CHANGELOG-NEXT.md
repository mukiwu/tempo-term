## 正體中文

### feat

- macOS 選單列改用原生系統選單：完整的 File／Edit／View／Terminal／Window／Help 移進畫面最上方的系統選單列（VSCode 式），分頁列與紅綠燈合併成同一排，視窗內不再佔一條選單列；跟隨主題與介面語言，快捷鍵全數保留 (#190)
- 右鍵選單全平台統一：純文字輸入框改用 app 風格的剪下／複製／貼上／全選選單（Windows 貼上改走 Tauri 快速路徑，不再等 5 秒），終端機選單擴充為複製／貼上／全選／清除／搜尋，空白區域不再彈出瀏覽器預設選單；筆記與程式碼編輯器維持原生選單不變 (#184, #199)
- session 標題優先採用 Claude Code `/rename` 設定的名稱：AI session 列表不再顯示 `<system-reminder>` 之類的雜訊當標題，抓不到 rename 名稱時維持原本行為 (#183, #201)

### fix

- 修正 macOS 原生選單（含編輯器的查詢、翻譯等）在中文系統上顯示英文的問題：bundle 補上本地化宣告，且切換介面語言時同步更新 app 語言偏好（重啟後生效） (#200)
- 補上嚴格的 CSP 安全政策取代原本的全開設定：webview 只允許載入 app 自身資源與 Tauri IPC，關閉外部連線、遠端圖片等潛在外洩管道 (#202)

### 感謝

- 感謝 @oberonlai 貢獻 session 標題採用 `/rename` 名稱（#183）
- 感謝 @yw-chan 貢獻 Windows 文字輸入框的自訂剪下／複製／貼上選單（#184）
- 感謝 @saamuelng601-pixel 貢獻 Node 26 下 `localStorage` 測試環境的修復（#193）

## English

### feat

- The macOS menu bar is now the native system menu: the full File / Edit / View / Terminal / Window / Help set moves into the top-of-screen system menu bar (VSCode-style), the tab row merges up into the traffic-light row so the window no longer spends a row on an in-window menu; it follows the app theme and UI language and every shortcut still works (#190)
- Unified right-click behavior across platforms: plain text fields get an app-styled Cut / Copy / Paste / Select All menu (paste on Windows uses the fast Tauri clipboard path instead of the ~5s WebView2 one), the terminal menu grows to Copy / Paste / Select All / Clear / Search, and blank areas no longer pop the browser default menu; notes and code editors keep their native menus (#184, #199)
- Session titles now prefer the name set with Claude Code `/rename`: the AI session list stops showing noise like `<system-reminder>` as a title, and falls back to the previous behavior when no rename exists (#183, #201)

### fix

- Fix native macOS menus (including Look Up / Translate in editors) rendering in English on a Chinese system: the bundle now declares its localizations, and switching the display language also syncs the per-app language preference (takes effect after a restart) (#200)
- Ship a strict CSP instead of the previous wide-open policy: the webview may only load the app's own resources and Tauri IPC, closing external connections, remote images and other potential exfiltration channels (#202)

### Thanks

- Thanks to @oberonlai for contributing session titles that follow `/rename` (#183)
- Thanks to @yw-chan for contributing the custom Cut / Copy / Paste menu for text fields on Windows (#184)
- Thanks to @saamuelng601-pixel for contributing the `localStorage` test-environment fix on Node 26 (#193)
