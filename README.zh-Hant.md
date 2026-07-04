<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" alt="TempoTerm" />

# TempoTerm

一個 AI 原生的終端機工作區，把終端機、程式碼編輯器、檔案總管、Git 與 AI 助手整合在同一個視窗，並提供完整的正體中文支援

[English](./README.md) · **正體中文** · [简体中文](./README.zh-Hans.md)

</div>

TempoTerm 是一個用 Tauri 2 加 Rust 與 React 19 打造的桌面 app，把原生 PTY 終端機、程式碼編輯器、檔案總管、版本控制、網頁預覽、筆記、SSH／SFTP 遠端連線與自帶金鑰的 AI 助手放在一起，並提供完整的正體中文介面與對正體中文友善的終端機字體；也把工作整理成具名的群組，每個分頁的卡片即時追蹤對應 Claude 或 Codex CLI 工作階段的狀態，以及 Git 分支、worktree 與對應的 PR

<div align="center">

<img src="screenshots/hero.png" alt="TempoTerm 把終端機、編輯器、檔案總管與 AI 助手放在同一個視窗" width="860" />

</div>

## 功能

### 群組與 Agent 工作階段

- 在側邊欄用具名群組整理工作，可從清單重新命名與刪除，app 一開就停在這個面板
- 每個分頁的卡片顯示 Git 分支與 worktree、即時的 Claude 或 Codex CLI 工作階段狀態徽章（執行中、思考中、等待輸入、等待批准，可依狀態篩選），以及對應的 PR 狀態
- 一個分頁分割成多個面板時，卡片會分別列出每個面板自己的 agent 與狀態
- 卡片標題會自動從工作階段的對話記錄推導出來
- 工作階段狀態來自一支可開關的 Claude Code 或 Codex hook；可在設定裡選卡片顯示哪些區塊，以及 PR 資料的來源
- 追蹤中的 agent 需要批准或執行完畢時，若視窗沒有聚焦會跳出桌面通知
- 可開啟多個視窗，各自擁有獨立的分頁、群組與對話狀態；關掉視窗只會收掉那個視窗自己的終端機
- 啟動器可以直接開啟 Claude Code 或 Codex CLI，並可設定預設帶入的參數

![群組側邊欄與即時 Claude 工作階段卡片](screenshots/workspaces.png)

### 終端機

- 以原生 PTY（portable-pty）驅動的 xterm.js v6，分頁可以指定類型
- 採用 xterm 的 DOM 渲染，刻意不用 WebGL，因為 WebGL 在 WKWebView 裡渲染字型不穩定
- 自由分割版面，同一組分割能混合不同類型，例如終端機與檔案編輯器並排，分割線可以拖曳調整比例
- 完整的鍵盤快捷鍵、zsh 指令自動建議、終端機內搜尋，以及 IP、host:port、壓縮檔的 hover 動作卡片
- 大量輸出保護（批次寫入加過載提示），並可自訂 shell 路徑
- 分頁可以拖曳重新排序，或右鍵重新命名、關閉，分頁列會以徽章顯示每個群組的分頁數
- 在輸出裡 Cmd 或 Ctrl 點擊檔案路徑，就會在旁邊的分割面板開啟，附 hover 提示，連被換行折斷的路徑也認得出來
- 可選擇在下次啟動時，把每個終端機的上次輸出以唯讀方式還原
- 對齊其他終端機的標準編輯快捷，方便轉移過來：Shift+Enter、依單字與行移動、刪到行首或行尾、複製貼上
- 採用 Unicode 11 字寬表，全形中文字維持對齊

### 分割面板

任何分頁裡的任何面板都能用四種方式分割：單擊側邊欄項目自動分割、把檔案或筆記拖到面板上、用右鍵選單、或拖到分頁列開新分頁

| **單擊自動分割**<br>單擊檔案總管或筆記裡的項目，直接分割進目前分頁<br>![單擊自動分割](screenshots/split-click.gif) | **拖曳到面板**<br>把檔案或筆記拖到任一面板，依放開位置決定分割方向<br>![拖曳到面板](screenshots/split-drag.gif) |
| --- | --- |
| **右鍵選單**<br>右鍵選擇在新分頁開啟，或分割成新面板<br>![右鍵選單](screenshots/split-context-menu.gif) | **拖曳到分頁列**<br>把檔案、筆記或 SSH 連線拖到分頁列，直接開新分頁<br>![拖曳到分頁列](screenshots/split-tab-drop.gif) |

### 編輯器

- CodeMirror 6 加語法高亮
- AI ghost-text 行內補全，按 Tab 接受
- 跟著 app 主題切換明暗
- Markdown 檔案可在編輯、並排、預覽之間切換
- 分頁有未存變更時，關閉會跳確認；分頁上有個小圓點標示未存
- 檔案在磁碟上被改動時（例如被 AI 或其他工具改動），沒有未存修改就自動重新載入，有的話會提示選擇版本，另外也有手動重新整理鈕
- 工具列可一鍵預覽 HTML 檔（詳見下方網頁預覽）

### 檔案總管

- 檔案樹，支援模糊搜尋與內容 grep
- 與終端機目錄雙向同步：任一邊 cd，另一邊跟著切
- 右鍵選單：開啟、在 Finder 顯示、新增檔案或資料夾、複製路徑、附加給 AI 助手、刪除到垃圾桶
- 把檔案或資料夾拖到任一面板，依面板類型有對應行為

### SSH 與遠端檔案

- 從獨立的連線面板連上 SSH 主機，連線資訊與金鑰密碼可以記住
- 支援本機埠轉發（-L）
- 連線開著時，可以在檔案總管用 SFTP 瀏覽、上傳、下載、直接編輯遠端檔案

### 版本控制

- 暫存、取消暫存、提交與推送，變更依資料夾分組，可整個資料夾一次 stage
- 用 AI 從 staged diff 產生 Conventional Commits 訊息
- 提交圖（DAG）與分支、tag 操作；點任一 commit 看變更檔案與 diff
- 讓 AI 用白話、好掃讀的方式解釋這個 commit 的 diff
- 工具列支援遠端分支、stash、fetch 與關鍵字搜尋

![Git 提交圖](screenshots/git-graph.png)

### 網頁預覽

- 用原生子 webview（不是 iframe）預覽一個網址或拖進來的本機檔案，不會被 X-Frame-Options 這類反嵌入規則擋下來
- 從編輯器工具列一鍵開啟檔案的即時預覽，存檔就會更新
- 分頁標題跟隨網頁實際的 `<title>`
- 上一頁／下一頁按鈕，也可用 ⌘[ 與 ⌘] 切換
- ⌘L 直接跳到網址列

### 筆記

- 所見即所得編輯器（TipTap），內建斜線指令選單
- 程式碼區塊支援語法高亮、複製與在終端機執行
- 全域資料夾，重啟後依然保留

### AI 助手

- 自帶金鑰：OpenAI、Anthropic、Google Gemini、Groq、DeepSeek、Ollama，以及任何相容 OpenAI 的端點
- 服務商金鑰與 GitHub token 存在一個跟這台機器綁定的加密檔案裡，不會回傳到 app 視窗
- 回覆以 Markdown 呈現，可從檔案總管把檔案附加為情境
- 預設會把終端機輸出納入情境，送出前會先遮蔽機密資訊

![AI 助手面板與 Markdown 回覆](screenshots/ai-assistant.png)

### 狀態列

- 即時顯示 CPU、記憶體與網路上下行流量
- Port 監看：列出監聽中的 port、佔用的程式與資源用量，可直接開瀏覽器、開一個終端機到該程式，或結束程式

### 主題與語系

- 多套深色與淺色主題，套用到整個視窗
- 正體中文與英文雙語介面，可即時切換
- 對正體中文友善的終端機字體設定，並可自訂 icon 字體

![主題與語系設定](screenshots/themes.png)

## 技術堆疊

Tauri 2、Rust、portable-pty、git2、keyring、russh、React 19、TypeScript、Vite、Zustand、Tailwind CSS v4、xterm.js v6、CodeMirror 6、TipTap、i18next

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
