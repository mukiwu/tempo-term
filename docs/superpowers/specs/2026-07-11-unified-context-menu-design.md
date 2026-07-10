# 跨平台統一右鍵選單設計

日期 2026-07-11，延伸自 PR #184

## 背景與目標

PR #184 之後右鍵選單行為在兩個平台分歧：Windows 的純文字欄位有 app 風格的剪下複製貼上選單、終端機有自訂複製貼上選單、其餘區域的預設選單被全面壓掉，macOS 這三塊卻都還是 WKWebView 原生選單。app 自己的八個自訂選單 surface（tab bar、檔案樹、git graph、source control 等）本來就跨平台一致，分歧只在這三塊

目標是把 macOS（含 Linux）的這三塊也統一成跟 Windows 相同的自訂行為，同時把終端機選單內容從陽春的兩項擴成標準五項

已確認的取捨：macOS 文字欄位與終端機會失去原生選單的查詢、翻譯、拼字建議、自動填入等系統功能，使用者已接受，以跨平台一致性優先

成功標準

- 三個平台右鍵行為一致：文字欄位出自訂選單、終端機出自訂五項選單、其餘區域無選單
- 筆記（Tiptap）與編輯器（CodeMirror）兩平台都維持原生選單，行為不變
- dev build 的空白區域保留原生選單（三平台一致，Windows dev 也會看到原生選單，屬預期），macOS 開發時右鍵 Inspect Element 不受影響
- Windows 行為與 #184 相比零變化（終端機選單多三項除外）
- 既有測試全綠，新行為有對應測試

## 方案選擇

比較過三條路，採拆閘門擴充案

1. 拆閘門擴充（採用）：#184 的 InputContextMenu 與 TerminalView 選單本來就是跨平台寫法，只是被 IS_WINDOWS 閘門擋住，把閘門拆掉、擴充終端機選單項目即可，改動集中且 Linux 自動跟上
2. 集中式選單 registry：把全 app 八個選單 surface 重構成單一註冊表，工程量大十倍，解決的是不存在的痛，違反 YAGNI
3. OS 原生 context menu（muda）：每次右鍵走 IPC 到 Rust 組原生選單，樣式與 app 主題脫節、兩平台外觀又不同，跟統一目標矛盾，也違反本專案自建元件的慣例

## 架構與改動點

### 1. InputContextMenu 全平台化

`src/components/InputContextMenu.tsx`

- 拿掉 effect 開頭的 `if (!IS_WINDOWS) return`，三個平台都掛 window contextmenu listener
- 文字欄位分支與 rich editable 分支邏輯不變（isPlainTextField 出自訂選單、isContentEditable 保留原生）
- 空白區域的 blanket `e.preventDefault()` 加 dev 例外：`import.meta.env.DEV` 時不壓，保留右鍵 Inspect 的除錯路徑。文字欄位與終端機的自訂選單在 dev 照常生效，功能仍可在 dev 驗證
- 貼上維持現有路徑：`terminalClipboardText()` 快路徑優先，失敗 fallback `navigator.clipboard.readText()`，macOS 走 fallback 也沒有 WebView2 慢貼上問題

### 2. 終端機選單統一與擴充

`src/modules/terminal/TerminalView.tsx`

- 拿掉 onContextMenu 裡的 `if (!IS_WINDOWS) return`，三平台都出自訂選單
- 選單項目從複製、貼上兩項擴成五項，分組如下

| 群組 | 項目 | 行為 | disabled 條件 |
|------|------|------|---------------|
| 0 | 複製 | `term.getSelection()` 寫入 clipboard | 無選取時 |
| 0 | 貼上 | 走既有 `pasteRef.current("cmd")` 快路徑 | 無 |
| 0 | 全選 | `term.selectAll()` | 無 |
| 1 | 清空畫面 | 接既有 clear 邏輯（與選單列或快捷鍵同一條路） | 無 |
| 1 | 搜尋 | 開啟既有 SearchBar | 無 |

- 沿用 #184 加入 ContextMenu 的 disabled 支援，複製在無選取時 greyed 而不是隱藏，選單形狀穩定
- macOS 既有的 capture-phase paste 攔截（防右鍵貼上與 Edit 選單貼上重複）在原生選單消失後自然不再觸發，保留不動，作為 Edit 選單貼上的防護

### 3. SourceControlView 區域壓制器退役

`src/modules/source-control/SourceControlView.tsx`

- 面板層級的 onContextMenu 壓制器（非 input 目標一律 preventDefault）在全域壓制後成為冗餘，移除
- 它原本對 input 放行原生選單的行為，統一後由 InputContextMenu 接手出自訂選單，行為從原生選單變成自訂選單，屬預期變化

### 4. i18n

- 實作時修正：終端機選單沿用既有的 terminal 前綴鍵（terminalCopy、terminalPaste 本來就在），新增 terminalSelectAll、terminalClear，搜尋放 terminalSearch.label（common.json 已有 terminalSearch 物件給 SearchBar 用，攤平鍵會撞名蓋掉它）
- 原定沿用 actions 命名空間的想法作廢，terminal 前綴的區域性更好

## 錯誤處理

- clipboard 寫入失敗沿用 #184 慣例：複製失敗靜默、剪下失敗保留選取不動、貼上失敗 fallback 後仍失敗則無操作
- 選單動作執行時 pane 已被關閉：所有動作透過 ref 或 store 取得當下狀態，目標消失即靜默 no-op
- xterm 未就緒（term 為 null）時右鍵：不出選單，交回 blanket 壓制

## 測試策略

- inputMenuItems 純函式測試已存在，不受影響
- InputContextMenu：新增測試證明非 Windows 平台（IS_WINDOWS false）也會攔截文字欄位右鍵並出選單，dev 例外用 vi.stubEnv 驗證空白區域不壓、prod 壓
- TerminalView：既有 Windows 選單測試改為平台無關，新增五項選單的行為測試（複製 disabled 條件、清空與搜尋的接線）
- SourceControlView：移除壓制器後既有測試調整，input 右鍵行為改斷言交給全域 handler
- App 層跑既有全套回歸

## 風險與備註

- Linux 沒有本機可驗，行為推導自與 macOS 相同的程式路徑，terminal 貼上走 pasteRef 與平台無關
- macOS 使用者若依賴文字欄位原生選單的系統功能會有感，發版 changelog 要寫清楚
- windows-tauri skill 的 pre-flight 清單在收尾時過一次，本次改動移除平台分支、不新增平台相依 code，風險低
