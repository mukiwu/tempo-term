## 正體中文

### feat

- 所有變更頁面可以挑比較基準，支援遠端預設分支、任意 branch 或 tag、貼上的 commit，以及 a..b 範圍；Git Graph 的提交詳情也能把選取範圍丟到整頁閱讀 (#424)

### perf

- Git Graph 的載入更多改為一次讀一頁，並解除 2000 筆的歷史上限 (#432)

### fix

- 編輯器在檔案讀不到時保留窗格工具列，分割中的窗格才關得掉 (#443)
- Git Graph 的分支超過六條時不再疊在同一欄，欄距會自動收窄 (#425)
- Git Graph 在窄窗格開啟搜尋時工具列按鈕不再重疊，並可用 Ctrl/Cmd+F 開啟搜尋 (#433)
- 在所有變更頁面關閉檔案後，該檔標題會留在原位 (#431)
- 新分頁的面板高度不夠時改用捲軸，選項不再蓋住相鄰窗格 (#428)
- 修正 Windows 磁碟路徑無法載入內建預覽 (#427)
- Git Graph 搜尋提交時保留完整線圖，並可逐筆導覽符合結果 (#426)

## English

### feat

- Choose what the all-changes page compares against, from the remote default branch, any branch or tag, a pasted commit, or an a..b range; the graph's commit details can hand a selection over to the page (#424)

### perf

- Load graph history one page at a time, and lift the 2000-commit ceiling (#432)

### fix

- Keep the editor's pane toolbar when a file cannot be read, so a split pane can still be closed (#443)
- Narrow the graph lanes instead of stacking branches on one column (#425)
- Make room for the search box in a narrow graph toolbar, and open it with Ctrl/Cmd+F (#433)
- Hold a closed file's header in place while the all-changes page settles (#431)
- Scroll the launcher list in a short pane instead of overlapping neighbouring panes (#428)
- Load Windows drive paths in the built-in preview (#427)
- Keep full graph context while navigating commit search matches (#426)
