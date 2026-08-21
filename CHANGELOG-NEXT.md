## 正體中文

### fix

- 修正 macOS 建立 PTY 時，子行程在 `fork()` 後掃描檔案描述符可能造成的首次啟動崩潰。
- 降低背景 WebView 的終端與輪詢負載，並加入保留 PTY／SSH 與未儲存編輯內容的工作區重新整理復原流程。
- 關閉仍有終端或 SSH 工作階段的視窗／App 前顯示可停用的原生確認提示，支援 macOS 與 Windows。

### 貢獻者

- @mark22013333

## English

### fix

- Fixed a macOS first-launch crash caused by scanning file descriptors in the post-`fork()` PTY child.
- Reduced background WebView terminal and polling load, and added workspace reload recovery that preserves PTY/SSH sessions and unsaved editor buffers.
- Added an optional native confirmation before closing a window or quitting with live terminal or SSH sessions on macOS and Windows.

### Contributors

- @mark22013333
