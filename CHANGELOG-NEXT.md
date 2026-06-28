## 正體中文

### feat
- 編輯器檔案重新整理：開啟的檔案被外部或 AI 改動後不用關掉重開，工具列多了一個重新整理鈕可隨時載入最新內容，若有未存修改會先確認；編輯器也會自動偵測磁碟變更，沒有未存修改時自動重載，有的話跳出提示讓你選要用磁碟版本還是保留自己的

### fix
- 終端機裡被程式（例如 AI agent）折成兩行的長檔案路徑，現在點上下任一段都打得開，會自動把被斷開的路徑接回來再開
- Windows 終端機現在可以貼上了：貼剪貼簿文字，或貼在檔案總管裡複製的檔案路徑都行，右鍵選單也補上了複製與貼上
- Windows 上的 Claude 狀態 hook 現在會正常觸發：之前 hook 的路徑用反斜線，被 bash 當成逃脫字元吃掉導致整個失效，改用正斜線（Git Bash 也吃得下）後就正常了

## English

### feat
- Editor file reload: when an open file changes on disk (e.g. an AI agent edits it), pick up the new content without closing and reopening the tab. A toolbar refresh button reloads on demand (confirming first if you have unsaved edits), and the editor also watches the file: a clean buffer reloads automatically, while unsaved edits raise a banner to choose between the disk version and your own

### fix
- File paths that a program (e.g. an AI agent) hard-wraps across two lines in the terminal are now clickable: clicking either half opens the rejoined path
- Terminal paste now works on Windows: paste clipboard text, or the path of a file copied in Explorer, plus a right-click Copy/Paste menu
- The Claude status hook now fires on Windows: its script path used backslashes that bash treated as escapes and dropped, so the hook is now stored with forward slashes that Git Bash accepts
