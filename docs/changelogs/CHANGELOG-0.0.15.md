## 正體中文

### feat

- 原始碼控制側欄的「近期提交」清單新增精簡版提交圖，用色點與連線標出提交順序、分支分岐、合併與目前 HEAD 位置
- 檔案搜尋改成從頂部標題列開啟的全域搜尋面板（Cmd/Ctrl+P），不再侷限於檔案總管側欄；全寬顯示讓檔名與相對路徑不必再靠 tooltip 才看得完整，並新增「最近開啟的」清單
- Git Graph 提交圖支援方向鍵導覽，並可用 Shift+點擊或方向鍵選取兩筆提交進入比較模式，直接看兩個版本間的差異
- 筆記側邊欄新增變更筆記資料夾的按鈕，資料夾選錯或想換位置時可以重新指定，切換前會先跳確認，不會動到原本磁碟上的筆記

### fix

## English

### feat

- Added a compact commit graph beside the sidebar's Recent commits list, showing commit order, branch divergence, merges and the current HEAD position
- Moved file search into a global search palette opened from the top header (Cmd/Ctrl+P) instead of the Explorer sidebar; the full-width layout shows filenames and relative paths in full without a tooltip, and adds a "Recently opened" list
- Added arrow-key navigation to the Git Graph commit list, plus a two-commit compare mode (via Shift+click or arrow keys) to diff any two commits directly
- Added a button to the notes sidebar for changing the notes folder after it's already been set; a confirmation dialog appears before switching, and existing notes stay untouched on disk

### fix
