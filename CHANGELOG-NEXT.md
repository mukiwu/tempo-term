## 正體中文

### feat
- 編輯器檔案重新整理：開啟的檔案被外部或 AI 改動後不用關掉重開，工具列多了一個重新整理鈕可隨時載入最新內容，若有未存修改會先確認；編輯器也會自動偵測磁碟變更，沒有未存修改時自動重載，有的話跳出提示讓你選要用磁碟版本還是保留自己的
- Logs 面板：左側欄新增一個記錄面板，自動把每個終端機 session（本機與 SSH，包含在終端機裡跑的 Claude Code、Codex 對話）的輸出存成獨立檔案，點一下就在主分頁區開啟，可用乾淨文字或 Raw ANSI 檢視、複製、另存，點別的記錄會直接換到同一個分頁；設定裡可開關記錄與選保留期限（預設 30 天）
- HTML 網頁預覽：開 HTML 檔時編輯器右上角多了預覽按鈕，點一下就用網頁預覽看這支檔，單一面板時在旁邊並排、已分割時開到可重用的預覽分頁；存檔後預覽會自動更新，邊改邊看
- 狀態列 port 監看：當你有正在監聽的 port 時，設定鈕旁邊會出現 port 圖示和數量，點開面板會列出每個 port、佔用它的程式以及該程式的 CPU／記憶體用量，可展開看 PID、綁定位址、完整指令與工作目錄；每個 port 都能直接在瀏覽器開、在它的工作目錄開一個終端機分頁、複製資訊或結束程式（結束前會先確認）；預設只顯示你自己的服務，可切換成顯示全部（含系統服務）

### fix
- 終端機裡被程式（例如 AI agent）折成兩行的長檔案路徑，現在點上下任一段都打得開，會自動把被斷開的路徑接回來再開
- Windows 終端機現在可以貼上了：貼剪貼簿文字，或貼在檔案總管裡複製的檔案路徑都行，右鍵選單也補上了複製與貼上
- Windows 上的 Claude 狀態 hook 現在會正常觸發：之前 hook 的路徑用反斜線，被 bash 當成逃脫字元吃掉導致整個失效，改用正斜線（Git Bash 也吃得下）後就正常了
- 終端機長時間使用後中文字會渲染成亂碼的問題已修：原因是 WebGL 字形快取塞滿後畫到錯的字，現在會在快滿之前自動清一次快取，不用再手動切換字體
- 側邊欄切換到工作區面板時短暫卡頓、像當機的問題已修：原因是面板每次顯示都重複做大量計算，現在改成只算必要的部分，切換變順
- Git 線圖點開 commit 看 diff 時的卡頓已修：之前不論 diff 多長都一次把每一行畫成節點，大檔會塞進上千個 DOM；現在只渲染可視範圍內的行，超長 diff 也順
- Git 線圖在正式版（Windows）點 commit／檔案時明顯延遲、視窗閃一下的問題已修：正式版沒有主控台，每次跑 git 都被 Windows 配一個新主控台視窗、每次多花上百毫秒；現在用 CREATE_NO_WINDOW 抑制，點開 diff 立即反應（開發版有主控台所以一直都正常）
- Git 線圖 commit 詳情的變更檔案清單也改成虛擬化：改動上千個檔案的 commit 不再一次掛上幾千個項目；左欄維持整欄單一卷軸，metadata／訊息和檔案清單一起捲動

### 感謝
- Windows 終端機貼上、Windows 上的 Claude 狀態 hook 修正由 @craig7351 貢獻（#75、#76）
- Git 線圖 diff 與檔案清單虛擬化、Windows 正式版點開 diff 延遲的修正由 @yw-chan 貢獻（#82）

## English

### feat
- Editor file reload: when an open file changes on disk (e.g. an AI agent edits it), pick up the new content without closing and reopening the tab. A toolbar refresh button reloads on demand (confirming first if you have unsaved edits), and the editor also watches the file: a clean buffer reloads automatically, while unsaved edits raise a banner to choose between the disk version and your own
- Logs panel: a new sidebar panel records every terminal session's output (local and SSH, including Claude Code / Codex conversations running in the terminal) to its own file. Click a log to open it in a reusable main-area tab, view it as clean text or raw ANSI, copy or save it, and clicking another log swaps that same tab. Settings add an enable toggle and a retention policy (default 30 days)
- HTML web preview: editing an HTML file shows a preview button in the editor toolbar; clicking it previews the file, split beside the editor when the tab is unsplit or in a reusable preview tab when it is already split. The preview reloads automatically when you save, so you can edit and watch side by side
- Port monitor in the status bar: when you have listening ports, a port icon with a count appears next to Settings. Open the panel to see each port, the process using it, and that process's CPU / memory; expand a row for its PID, bind address, full command, and working directory. Each port can be opened at localhost:PORT in the browser, given a terminal tab in its working directory, copied, or killed (with a confirmation first). It shows only your own services by default, with a toggle to reveal all (including system services)

### fix
- File paths that a program (e.g. an AI agent) hard-wraps across two lines in the terminal are now clickable: clicking either half opens the rejoined path
- Terminal paste now works on Windows: paste clipboard text, or the path of a file copied in Explorer, plus a right-click Copy/Paste menu
- The Claude status hook now fires on Windows: its script path used backslashes that bash treated as escapes and dropped, so the hook is now stored with forward slashes that Git Bash accepts
- Fixed CJK text rendering as garbled glyphs after a long terminal session: the WebGL glyph cache overflowed and drew the wrong glyphs, so the cache is now cleared automatically before it fills up, with no need to switch fonts by hand
- Fixed a brief freeze when switching the sidebar to the Workspaces panel: the panel repeated heavy work every time it showed, and now computes only what it needs so the switch stays responsive
- Fixed jank when opening a commit's diff in the git graph: every diff line was rendered as a DOM node regardless of length, so large files mounted thousands at once; only the rows in the viewport are now rendered, keeping even very long diffs smooth
- Fixed a noticeable delay (and window flash) when opening a commit or file diff in the git graph on Windows release builds: a release build has no console, so Windows allocated a fresh console for every git subprocess, costing ~100ms per call; spawning with CREATE_NO_WINDOW removes it so diffs open instantly (dev builds own a console, which is why they were never affected)
- The changed-files list in a commit's details is now virtualized too: a commit touching thousands of files no longer mounts thousands of list items at once. The left column still scrolls as a single unit, with the metadata, message, and file list all under one scrollbar

### Thanks
- Windows terminal paste and the Windows Claude status hook fix were contributed by @craig7351 (#75, #76)
- Git graph diff & file-list virtualization and the Windows release diff-open lag fix were contributed by @yw-chan (#82)
