## 正體中文

### feat

### fix

- 修正 Worktree 面板無法移除「目錄已不存在」項目的問題。先前按移除會執行 git worktree remove，部分 git 版本（如 Apple Git 2.50）會因驗證目錄失敗而報錯；現改走 git worktree prune，任何版本都能把殘留紀錄清掉，一般 worktree 的移除行為不變 (#386)
### 貢獻者

## English

### feat

### fix

- Fix the Worktrees panel failing to remove an entry whose directory no longer exists. The remove button ran git worktree remove, which some git versions (e.g. Apple Git 2.50) reject with a validation error for a gone directory; stale rows now go through git worktree prune, which clears the record on every version, while normal removals keep their exact semantics (#386)
### Contributors
