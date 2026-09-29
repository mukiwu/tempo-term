## 正體中文

### feat

- commit 和分支的右鍵選單可以開啟變更、和工作區比較，或設為比較基準 (#459)

### fix

- Git Graph 最上面未提交變更那一列的文字，改成跟下方各列對齊；節點改用實線空心環，不再是碎掉的虛線圈 (#456)
- Git Graph 分割成兩個時按 Cmd+F，只會打開目前所在那一邊的搜尋框，不再連其他 Git Graph 分頁一起打開 (#458)
- Git Graph 搜尋框打第一個字時，工具列不會突然把按鈕收進選單；搜尋框開著時也不會出現兩個顯示遠端分支的開關 (#458)
- 比較基準選單的選項不會再被 Tab 選到，按 Shift+Tab 離開時清單會跟著關閉 (#458)
- Workspace 卡片改列出各窗格所在的 repo，worktree 不再多顯示主 repo (#463)

### 貢獻者

- @yw-chan (#459)

## English

### feat

- Open changes, compare with the working tree, or set a comparison base from the commit and branch right-click menus (#459)

### fix

- Line up the graph's working-tree row with the commit rows below it, and draw its node as a solid hollow ring instead of a broken dashed one (#456)
- Open only the focused graph's search on Cmd+F when a split shows two, not every graph tab's (#458)
- Keep the Git Graph toolbar from folding its buttons away on the first keystroke of a search, and from showing the remote-branches toggle twice while the search is open (#458)
- Keep the comparison base list out of the Tab order and close it when Shift+Tab leaves it (#458)
- Show the repo each pane sits in on Workspace cards, without a worktree's main repo (#463)

### Contributors

- @yw-chan (#459)
