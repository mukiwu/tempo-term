<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" alt="TempoTerm" />

# TempoTerm

一個 AI 原生的終端機工作區，把終端機、程式碼編輯器、檔案總管、Git 與 AI 助手整合在同一個視窗，並提供完整的正體中文支援

[English](./README.md) · **正體中文** · [简体中文](./README.zh-Hans.md)

</div>

TempoTerm 是一個用 Tauri 2 加 Rust 與 React 19 打造的桌面 app，把原生 PTY 終端機、程式碼編輯器、檔案總管、版本控制、網頁預覽、筆記與自帶金鑰的 AI 助手放在一起，並提供完整的正體中文介面與對正體中文友善的終端機字體

## 功能

### 終端機

- 以原生 PTY（portable-pty）驅動的 xterm.js v6，分頁可以指定類型
- 自由分割版面，同一組分割能混合不同類型，例如終端機與檔案編輯器並排，分割線可以拖曳調整比例
- 在輸出裡 Alt 或 Cmd 點擊檔案路徑，就會在旁邊的分割面板開啟
- 對齊其他終端機的標準編輯快捷，方便轉移過來：Shift+Enter、依單字與行移動、刪到行首或行尾、複製貼上
- 採用 Unicode 11 字寬表，全形中文字維持對齊

### 編輯器

- CodeMirror 6 加語法高亮
- 跟著 app 主題切換明暗
- Markdown 檔案可在編輯、並排、預覽之間切換

### 檔案總管

- 檔案樹，支援模糊搜尋與內容 grep
- 右鍵選單：開啟、在 Finder 顯示、新增檔案或資料夾、複製路徑、附加給 AI 助手、刪除到垃圾桶
- 把檔案或資料夾拖到任一面板，依面板類型有對應行為

### 版本控制

- 狀態、暫存、取消暫存、提交與推送
- 帶提交圖的 Git 歷史

### 網頁預覽

- 內嵌預覽一個網址，或拖進來的本機檔案

### 筆記

- 所見即所得編輯器（TipTap），內建斜線指令選單
- 程式碼區塊支援語法高亮、複製與在終端機執行
- 全域資料夾，重啟後依然保留

### AI 助手

- 自帶金鑰：OpenAI、Anthropic、Google Gemini、Groq、DeepSeek、Ollama，以及任何相容 OpenAI 的端點
- 金鑰存在系統 keychain，不會回傳到 app 視窗
- 回覆以 Markdown 呈現，可從檔案總管把檔案附加為情境

### 主題與語系

- 多套深色與淺色主題，套用到整個視窗
- 正體中文與英文雙語介面，可即時切換
- 對正體中文友善的終端機字體設定

## 技術堆疊

Tauri 2、Rust、portable-pty、git2、keyring、React 19、TypeScript、Vite、Zustand、Tailwind CSS v4、xterm.js v6、CodeMirror 6、TipTap、i18next

## 開發

```bash
pnpm install        # 安裝前端依賴
pnpm tauri dev      # 以開發模式啟動桌面 app
pnpm typecheck      # TypeScript 型別檢查
pnpm build          # 建置前端
```

## 測試

```bash
pnpm test                       # 前端單元與整合測試（Vitest）
cd src-tauri && cargo test      # 後端 Rust 測試
```
