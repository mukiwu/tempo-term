## 正體中文
- feat(diff): 所有變更頁面可以挑比較基準，支援遠端預設分支、任意 branch 或 tag、貼上的 commit，以及 a..b 範圍；Git Graph 的提交詳情也能把選取範圍丟到整頁閱讀
- fix(git-graph): 分支超過六條時不再疊在同一欄，欄距會自動收窄
- perf(git-graph): 載入更多改為一次讀一頁，並解除 2000 筆的歷史上限
- fix(git-graph): 窄窗格開啟搜尋時工具列按鈕不再重疊，並可用 Ctrl/Cmd+F 開啟搜尋
- fix(diff): 在所有變更頁面關閉檔案後，該檔標題會留在原位
- fix(launcher): 面板高度不夠時改用捲軸，選項不再蓋住相鄰窗格
- fix(preview): 修正 Windows 磁碟路徑無法載入內建預覽
- fix(git-graph): 搜尋提交時保留完整線圖，並可逐筆導覽符合結果

## English
- feat(diff): choose what the all-changes page compares against, from the remote default branch, any branch or tag, a pasted commit, or an a..b range; the graph's commit details can hand a selection over to the page
- fix(git-graph): narrow the lanes instead of stacking branches on one column
- perf(git-graph): load history one page at a time, and lift the 2000-commit ceiling
- fix(git-graph): make room for the search box in a narrow toolbar, and open it with Ctrl/Cmd+F
- fix(diff): hold a closed file's header in place while the all-changes page settles
- fix(launcher): scroll the launcher list in a short pane instead of overlapping neighbouring panes
- fix(preview): load Windows drive paths in the built-in preview
- fix(git-graph): keep full graph context while navigating commit search matches
