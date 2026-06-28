## 正體中文

### feat
- 編輯器檔案重新整理：開啟的檔案被外部或 AI 改動後不用關掉重開，工具列多了一個重新整理鈕可隨時載入最新內容，若有未存修改會先確認；編輯器也會自動偵測磁碟變更，沒有未存修改時自動重載，有的話跳出提示讓你選要用磁碟版本還是保留自己的

### fix
- 終端機裡被程式（例如 AI agent）折成兩行的長檔案路徑，現在點上下任一段都打得開，會自動把被斷開的路徑接回來再開

## English

### feat
- Editor file reload: when an open file changes on disk (e.g. an AI agent edits it), pick up the new content without closing and reopening the tab. A toolbar refresh button reloads on demand (confirming first if you have unsaved edits), and the editor also watches the file: a clean buffer reloads automatically, while unsaved edits raise a banner to choose between the disk version and your own

### fix
- File paths that a program (e.g. an AI agent) hard-wraps across two lines in the terminal are now clickable: clicking either half opens the rejoined path
