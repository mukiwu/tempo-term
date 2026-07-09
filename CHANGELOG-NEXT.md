## 正體中文

### feat

- Windows 現在也能追蹤 Claude Code / Codex 的 session 狀態燈：改用本機 loopback socket 遞送狀態（app 內建的原生 shim，取代在 Windows 無法運作的 `/dev/tty` OSC 機制），狀態訊息以每個分頁的 pty id 標記回對應面板 (#155)

### fix

- 修復 Windows 上狀態 hook 反覆彈出「挑選應用程式」對話框的問題；由於 OSC→PTY 狀態機制在 Windows 無法運作，改為不再注入 hook，並自動清除舊版留下的設定 (#155)

## English

### feat

- Windows can now track Claude Code / Codex session status too: state is delivered over a local loopback socket (a native shim built into the app, replacing the `/dev/tty` OSC mechanism that has no Windows backend), tagged with each pane's pty id so it lights the right card (#155)

### fix

- Stop the status hook from spamming the Windows "Open With" dialog: the OSC→PTY status mechanism does not work on Windows, so we no longer inject the hook there and clean up any entries an older build left behind (#155)
