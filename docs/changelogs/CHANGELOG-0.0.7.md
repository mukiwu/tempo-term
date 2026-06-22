## 正體中文

### feat
- 支援 Codex CLI：Codex 的工作階段會即時追蹤，Workspace 卡片與進度面板會標出目前是 Claude 還是 Codex
- 一個分頁切成多個 panel 時，Workspace 卡片會分別列出每個 panel 正在跑的 agent，各自有狀態與標題
- 可以開新視窗，每個視窗的分頁、工作區與對話狀態各自獨立，關閉視窗會一併收掉它的終端機
- Git 線圖會標出目前所在的 commit（HEAD），節點以強調色高亮並帶柔和光暈
- 視窗拖曳區延伸到分頁列的空白處，從那裡也能拖動視窗
- 提供 Windows 版本

### fix
- Git 線圖的 orange 與 yellow 分支線顏色調開，兩條並排時不再相似

### perf
- Codex 進度監看只在檔案新增或更名時重掃，平常更省資源

## English

### feat
- Codex CLI support: Codex sessions are tracked live, and workspace cards and the progress panel label whether a session is Claude or Codex
- When a tab is split into panes, the workspace card lists each pane's running agent separately, each with its own status and title
- Open new windows, each with its own isolated tabs, workspace, and chat state; closing a window shuts down its terminals
- The git graph marks the current commit (HEAD) with an accent-coloured node and a soft glow
- The window drag region reaches into the empty area of the tab bar, so you can drag the window from there too
- A Windows build is now available

### fix
- The git graph's orange and yellow branch lanes are pulled apart so adjacent lanes no longer look alike

### perf
- The Codex progress watcher only rescans on file create or rename, so it uses fewer resources otherwise
