## 正體中文

### feat

- Apple Intelligence 成為可選的預設模型（macOS 26 以上且系統已啟用時才會出現，Windows 不會看到這個選項）：選定後 commit message 產生、diff 解釋與行內補完都改由裝置上的模型回答，不需金鑰、資料不離開本機。AI 助手面板刻意不提供它——預設是 Apple Intelligence 時，對話會改用面板上另選的雲端模型，且切換不影響預設值 (#395)
- Ports 面板全面翻新：清單改依 port 排序、不再每次輪詢重新洗牌；port 依專案分組（cwd 目錄名為組標題、其他程序墊底），每列以白話的服務名稱開頭（Vite dev server、Next.js dev server、PostgreSQL 等），CPU 與記憶體移入展開詳情；macOS 26 以上且開啟 Apple Intelligence 時，動作列第一顆是「詢問 AI」，由裝置上的模型直接說明該行程與是否可安全停止，回答以 markdown 樣式呈現，資料不離開本機 (#388, #391)
### fix

- 修正 Worktree 面板無法移除「目錄已不存在」項目的問題。先前按移除會執行 git worktree remove，部分 git 版本（如 Apple Git 2.50）會因驗證目錄失敗而報錯；現改走 git worktree prune，任何版本都能把殘留紀錄清掉，一般 worktree 的移除行為不變 (#386)
### 貢獻者

## English

### feat

- Apple Intelligence becomes a selectable default model (shown only on macOS 26+ with the system model available; Windows never sees the option): commit message generation, diff explains and inline completion then run on-device, keyless, with nothing leaving the machine. The AI assistant panel deliberately excludes it — with an Apple default, conversations use a separately chosen cloud model and switching it never touches the default (#395)
- The Ports panel is reworked: the list is sorted by port and no longer reshuffles on every poll; ports are grouped by project (cwd basename as sticky headers, other processes last), rows lead with plain-English service names (Vite dev server, Next.js dev server, PostgreSQL, …) and CPU/memory move into the expanded details; on macOS 26+ with Apple Intelligence enabled, the action row leads with an Ask-AI button answered by the on-device model — what the process is and whether stopping it is safe, rendered as markdown, with nothing leaving the machine (#388, #391)
### fix

- Fix the Worktrees panel failing to remove an entry whose directory no longer exists. The remove button ran git worktree remove, which some git versions (e.g. Apple Git 2.50) reject with a validation error for a gone directory; stale rows now go through git worktree prune, which clears the record on every version, while normal removals keep their exact semantics (#386)
### Contributors
