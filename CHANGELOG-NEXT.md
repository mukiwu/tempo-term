## 正體中文

### feat

- 介面改成三欄:左右兩欄各有一排圖示切換器,而且圖示可以按著拖曳,在左右欄之間互相搬動,由你自己決定哪些功能放哪一邊。連接埠從原本的彈出面板改成正式的欄位面板,狀態列的數量徽章保留 (#219)
- 新增 Parallel Worktrees:同一個 repo 可以同時開好幾個 worktree,各自是獨立的目錄、各自跑自己的 agent,彼此不會互相干擾。終端機右上角的選單(⋯)可以直接新增,git 線圖上對著分支按右鍵也能為它開一個 (#220, #221, #222, #223, #224, #225)
- 新增 worktree 管理器:狀態列右下角的徽章顯示你目前總共有幾個 worktree,點開可以看到每個在哪個分支、有沒有還沒提交的改動、裡面的 agent 在忙什麼,也能按需要量它佔了多少硬碟。因為每個 worktree 都會帶著自己的 node_modules,這個數字得放在看得到的地方,不然會不知不覺塞爆硬碟 (#222, #223)
- 建立 worktree 時可以順便:把 git 不會帶過去的本機檔案複製進去(預設是 `.env` 那類)、跑一行設定指令(例如 `pnpm install`,每個 repo 各自記住)、以及直接叫起 Claude 或 Codex。`git worktree add` 只會給你版控裡的原始碼,少了這些,agent 的第一個指令就會死在找不到 `.env` (#225)
- 從管理器可以開啟已有的 worktree:開在新分頁,或是分割在你當下那個窗格旁邊方便對照。已經開著的會直接跳過去,不會在同一個目錄重複開一個 (#223)
- 終端機窗格長出標題列,跟編輯器同一個樣式:左邊顯示它在哪個目錄,右邊放選單和關閉。原本這兩顆按鈕是浮在終端機輸出上面的,會蓋到字 (#225)
- 全部八種窗格的頂部統一成同一條標題列:左邊是身分、右邊是動作和關閉按鈕,原本浮在內容上面的關閉鈕全面退場。終端機和編輯器的標題列改放麵包屑路徑(家目錄相對,不會跟著焦點跳動),點任一段會打開該層的子資料夾清單,按資料夾前面的 + 可以層層展開,點名稱就讓這個窗格直接 cd 過去;編輯器則是點檔名列出同資料夾的檔案,點了就在原窗格換檔,不會開新分頁。SSH 窗格透過 SFTP 一樣能用 (#226)

### fix

- 修正在 git 線圖的工具列切換 worktree 時,會把 `cd` 指令打進當下那個終端機的問題。那個終端機如果正在跑 agent,指令就直接打進它的提示字元裡 (#225)
- 移除 worktree 時會先把裡面的終端機關掉再讓 git 動手。Windows 上還活著的終端機會佔住自己所在的目錄,刪到一半會失敗 (#225)

## English

### feat

- Three-column layout: both side columns get their own icon switcher strip, and the icons can be dragged between left and right, so you decide which panels live where. Ports moves from a pop-up to a real panel, keeping its status-bar count badge (#219)
- Parallel Worktrees: run several worktrees of one repo side by side, each its own directory with its own agent, none of them in each other's way. Create one from a terminal's ⋯ menu, or right-click a branch in the git graph to open one for it (#220, #221, #222, #223, #224, #225)
- A worktrees manager: a status-bar badge counts every worktree you have, and opens onto what branch each one holds, whether it has uncommitted work, what its agent is doing, and — on request — how much disk it is using. Each worktree carries its own node_modules, so that count sits in view rather than being discovered by a full disk (#222, #223)
- Creating a worktree can also copy the local files git leaves behind (`.env` and friends by default), run a setup command (`pnpm install`, remembered per repo), and start Claude or Codex in it. `git worktree add` checks out tracked source only, so without those an agent's first command dies on a missing `.env` (#225)
- Open an existing worktree from the manager: in a tab of its own, or split beside the pane you are in when you want to compare the two. One that is already open takes you to it rather than starting a second shell in the same directory (#223)
- Terminal panes gained the header an editor pane already had: the directory on the left, the menu and close button on the right, instead of floating over the terminal's own output (#225)
- Every pane kind now tops out in the same header strip — identity on the left, actions and the close button on the right — and the close button that used to float over pane content is gone everywhere. Terminal and editor headers show a breadcrumb (home-relative, stable across focus changes): click a segment to open that folder's subdirectories, unfold levels with the + toggle, and click a name to cd this pane there; the editor's filename segment lists the files sharing its folder and swaps the file in place, never opening a tab. SSH panes get the same over SFTP (#226)

### fix

- Fix switching worktree from the git graph's toolbar typing `cd` into the focused terminal — which, if an agent was running there, went straight into its prompt (#225)
- Removing a worktree now closes the terminals inside it before git touches the directory. On Windows a live terminal holds its own directory open, and the removal fails halfway (#225)
