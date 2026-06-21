## 正體中文

### feat
- 設定面板可以按 Esc 或點面板外的區域關閉

### fix
- 工作區卡片的 Claude 工作階段狀態更準確：閒置等待輸入不再被誤標成等待批准，工具核准跑完後也會即時回到執行中
- gh CLI 改從常見安裝目錄解析，從 Finder 或 Dock 啟動的視窗也找得到，PR 狀態能正確載入
- 工作區卡片的長分支名稱與資料夾路徑改成完整換行，不再超出卡片框線
- 更新內容視窗改用 Markdown 呈現，標題與清單會正常排版，不再是純文字

### perf
- 終端機改用 WebGL 做 GPU 加速渲染，捲動與大量輸出更順，WebGL 不可用時自動退回原本的渲染方式

## English

### feat
- The settings panel can be dismissed with Esc or by clicking the area outside it

### fix
- More accurate Claude session status on workspace cards: an idle session waiting for input is no longer mislabeled as waiting for approval, and the badge returns to active right after an approved tool finishes
- Resolve the gh CLI from common install dirs so it is found even when launched from Finder or Dock, and PR status loads correctly
- Long branch names and folder paths on workspace cards now wrap in full instead of overflowing the card border
- The update notes dialog renders as Markdown, so headings and lists are formatted instead of shown as raw text

### perf
- GPU-accelerated terminal rendering via WebGL for smoother scrolling and heavy output, with a graceful fallback when WebGL is unavailable
