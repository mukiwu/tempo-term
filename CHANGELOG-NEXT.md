## 正體中文

### feat

### fix

- 修復 Windows 上狀態 hook 反覆彈出「挑選應用程式」對話框的問題；由於 OSC→PTY 狀態機制在 Windows 無法運作，改為不再注入 hook，並自動清除舊版留下的設定 (#155)

## English

### feat

### fix

- Stop the status hook from spamming the Windows "Open With" dialog: the OSC→PTY status mechanism does not work on Windows, so we no longer inject the hook there and clean up any entries an older build left behind (#155)
