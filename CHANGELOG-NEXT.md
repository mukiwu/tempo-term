## 正體中文

### feat

- 筆記標題列新增目錄按鈕：展開依層級縮排的浮動標題清單，內容隨當下文件即時更新，點擊即可跳到該標題並閃爍標示落點 (#241)
- 筆記內搜尋：點標題列的搜尋按鈕或按 `Cmd+F`／`Ctrl+F` 開啟，不分大小寫標示所有符合結果，`Enter`／`Shift+Enter` 前後跳轉並顯示目前是第幾筆 (#244)
- 選取筆記文字時會跳出指令面板，可直接套用粗體、斜體、刪除線、行內程式碼與連結；連結支援新增、編輯、移除且不會吃掉選取文字，原本的 `/` 指令與區塊轉換行為不變 (#245)

### fix

- 修正游標移入既有的 slash 開頭文字（如 `/stickers`）時，誤跳出空白區塊指令彈窗的問題 (#244)

## English

### feat

- Add a table-of-contents button to the note title row: a floating, level-indented heading list that stays in sync with the live document; clicking an entry jumps to that heading and flashes the destination (#241)
- Add in-note search: open it from the title toolbar or with `Cmd+F` / `Ctrl+F`, all matches are highlighted case-insensitively, and `Enter` / `Shift+Enter` step through results with a live match counter (#244)
- Selecting note text now opens the command panel with inline formatting: bold, italic, strikethrough, inline code, and links (add, edit, or remove without losing the selection); the existing `/` slash-command workflow is unchanged (#245)

### fix

- Fix an empty block-command popup appearing when the cursor enters existing slash-prefixed text such as `/stickers` (#244)
