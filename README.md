# TempoTerm

一個用 Tauri 打造的 AI 終端機工作區，把終端機、程式碼編輯器、檔案總管、Git、AI 助手與筆記整合在同一個視窗，介面支援正體中文與英文

## 技術堆疊

- Tauri 2 與 Rust 後端
- React 19、TypeScript、Vite 前端
- Zustand 狀態管理
- Tailwind CSS v4
- xterm.js v6 終端機
- CodeMirror 6 程式碼編輯器
- TipTap 筆記編輯器
- i18next 多語系（en 與 zh-Hant）

## 開發指令

```bash
pnpm install        # 安裝前端依賴
pnpm tauri dev      # 啟動桌面 app（開發模式）
pnpm test           # 跑前端單元與整合測試（Vitest）
pnpm typecheck      # TypeScript 型別檢查
pnpm build          # 建置前端
```

## 功能

- 分頁式工作區，每個分頁可以是終端機、編輯器、筆記、網頁預覽或 Git 圖
- 終端機可自由左右或上下分割，同一組分割能混合不同類型，例如終端機與檔案編輯器並排，分割線可拖曳調整比例
- 終端機輸出裡的檔案路徑可以點擊直接開啟，並對齊常見終端機的標準鍵盤快捷
- 從檔案總管把檔案或資料夾拖到面板，依面板類型有對應行為
- 多種佈景主題，深色與淺色皆備，編輯器也跟著切換明暗
- 對正體中文友善的終端機字體設定
- Markdown 檔案可在編輯、並排、預覽之間切換
- 所見即所得的筆記，支援斜線選單與程式碼區塊
- 自帶金鑰的多供應商 AI 對話，金鑰存在系統 keychain
- 整體介面正體中文與英文雙語，可即時切換並記住選擇

## 測試

```bash
pnpm test                       # 前端 Vitest
cd src-tauri && cargo test      # 後端 Rust 測試
```
