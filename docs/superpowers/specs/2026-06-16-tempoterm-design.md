# TempoTerm 設計規格

## 目標

用 Tauri 復刻 `crynta/terax-ai`，一個把終端機、程式碼編輯器、檔案總管與 AI 子系統整合在單一視窗的桌面開發工具。在復刻之外額外加上兩件 terax 原本沒有的能力：

1. 完整的正體中文語系（terax 目前只有英文，沒有任何 i18n）
2. 對正體中文友善的終端機字體設定（參考 Warp 的分層字體 fallback 概念，落實到 xterm.js 的世界）

## 技術堆疊

對齊 terax 原專案，降低參考與移植成本。

前端

- Tauri 2（桌面框架）
- React 19 + TypeScript
- Vite（建置工具）
- Zustand（狀態管理）
- Tailwind CSS v4（樣式）
- xterm.js v6（`@xterm/xterm`）含 addon：webgl、fit、unicode11、web-links、search
- CodeMirror 6（程式碼編輯器）
- Vercel AI SDK v6（`ai`、`@ai-sdk/*`）做 AI 子系統
- i18next + react-i18next（新增，terax 沒有）

後端 Rust

- tauri 2
- portable-pty（pseudo terminal）
- tokio（非同步執行緒）
- serde、serde_json（序列化）
- ignore、grep-regex、grep-searcher、grep-matcher（檔案搜尋）
- keyring（金鑰存 OS keychain）
- font-kit（跨平台系統字體列舉，支撐字體功能）
- tauri-plugin-store、tauri-plugin-log、tauri-plugin-os 等

## 與 terax 的關鍵差異

terax 用 xterm.js 跑在 webview 裡，不是 Warp 那種自寫 GPU 渲染器。Warp 的字體程式碼（swash 點陣化、Core Text cascade list）無法直接搬。我們把 Warp 的概念轉換到 xterm.js：

- 分層 fallback 改成 CSS 等寬字體 fallback 鏈：主字體後面接正體中文等寬字體
- 全形字寬改用 xterm.js 的 unicode11 addon 處理 East Asian Width
- 系統字體探索改用 Rust 的 font-kit 列舉，挑出可用的中文等寬字體
- 缺字偵測在前端比對，提示使用者安裝建議字體

## 專案結構

```
tempo-term/
  src-tauri/
    Cargo.toml
    tauri.conf.json
    build.rs
    src/
      main.rs
      lib.rs
      modules/
        pty/        session.rs, shell_init.rs, filter.rs
        fs/
        git/
        net/
        workspace/
        secrets/
        shell/
        fonts/      系統字體列舉 + CJK 等寬字體偵測（新增）
  src/
    main.tsx
    App.tsx
    i18n/           i18next 設定 + locales/en + locales/zh-Hant（新增）
    modules/
      terminal/     xterm.js session、OSC handler、renderer pool、pty-bridge
      editor/       CodeMirror 6 + AI 補全
      explorer/     檔案樹、模糊搜尋、鍵盤導航
      ai/           agents、sessions、tools、providers、chat store
      tabs/         分頁與分割面板模型
      source-control/  git 狀態、staging、commit UI
      git-history/  git graph 與歷史
      settings/     設定 UI + 偏好設定 store（含字體設定區）
      shortcuts/    keymap registry 與全域快捷鍵
    components/
    lib/
  package.json
  vite.config.ts
  tsconfig.json
```

## 元件與資料流

PTY 終端機（對齊 terax 做法）

- 前端 `pty-bridge.ts` 透過 Tauri `invoke` 呼叫 `pty_open`，帶 cols、rows、cwd 與 onData / onExit 兩個 Channel
- Rust 端用 `portable-pty` 的 `native_pty_system().openpty()` 開 pair，用 `shell_init::build_command` 組 shell 指令（設 TERM、COLORTERM、注入 OSC 7 / OSC 133 init script），再 `spawn_command`
- reader thread 連續讀 PTY master，coalesce 後透過 Channel 串回前端
- 暴露的指令：pty_open、pty_write、pty_resize、pty_close、pty_close_all、pty_shell_name 等

字體子系統（本專案重點）

- Rust `fonts` 模組用 font-kit 列舉系統字體，標記等寬與是否含 CJK glyph，暴露 `fonts_list_monospace`、`fonts_list_cjk` 指令
- 前端設定頁讓使用者挑主等寬字體與 CJK fallback 字體，存進偏好 store
- 套用時組成 CSS font-family 鏈交給 xterm.js，並啟用 unicode11 addon 校正全形字寬
- 若偵測不到可用的中文等寬字體，提示安裝建議清單（例如 Sarasa Mono TC、Noto Sans Mono CJK TC）

i18n

- i18next 初始化兩個語系：en 與 zh-Hant，預設依系統語言，可在設定切換並持久化
- 所有 UI 字串走 `t()`，locale 檔以模組分檔（terminal、settings、ai 等命名空間）

## 錯誤處理

- Rust 指令回傳 `Result<T, String>`，前端 invoke 以 try / catch 包裹並轉成使用者可讀訊息
- PTY 程序結束透過 onExit Channel 通知，前端標記該 session 已結束
- 字體列舉失敗時退回內建安全 fallback 鏈，不讓終端機白畫面

## 測試策略

- Rust 模組（pty session 行為、shell_init 指令組裝、fonts 偵測邏輯）寫單元測試
- 前端純邏輯（i18n 切換、字體鏈組裝、東亞字寬判斷、fuzzy 搜尋）用 Vitest 測行為
- UI 互動以少量整合測試覆蓋關鍵路徑，不硬湊覆蓋率
- 走 TDD：先寫測試（RED）再實作（GREEN）再重構

## 分階段交付

完整復刻工程量大，拆成可獨立驗證的階段，每階段結束時 app 都能跑：

- 階段 0　骨架與基礎：Tauri + React + Vite + TS + Tailwind 能開視窗；app shell 版面；i18n 基礎建設與語言切換；Zustand store 底座
- 階段 1　終端機核心：Rust pty 模組 + 前端 terminal 模組 + 分頁分割，做出可用終端機
- 階段 2　CJK 字體系統（重點）：Rust fonts 模組 + 字體設定 UI + CSS fallback 鏈 + unicode11 字寬 + 缺字提示 + 建議字體清單
- 階段 3　檔案總管：Rust fs 模組 + 前端檔案樹、模糊搜尋、grep
- 階段 4　程式碼編輯器：CodeMirror 6、開檔、語法高亮、存檔
- 階段 5　Git：Rust git 模組 + source-control UI + git-history
- 階段 6　AI 子系統：providers 設定、BYOK keyring、agent、chat store、tools、Plan 模式、AI UI、net proxy
- 階段 7　設定與偏好：完整設定 UI、preferences store、keyring 管理、各設定區
- 階段 8　建置與發佈打磨：app icon、macOS 打包

## 範圍與決策

- 完整復刻 terax 全部模組
- app 名稱 TempoTerm
- macOS 優先驗證，程式碼仍寫成跨平台
- 字體友善做完整版（設定 UI + fallback 鏈 + 字寬 + 缺字提示 + 建議清單）
