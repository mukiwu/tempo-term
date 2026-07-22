## 正體中文

### feat

- 新增 AI 對話恢復設定（預設關閉）：開啟後每次啟動 tempo-term，會用精確的 session ID 在原分頁與面板自動接續已儲存的 Claude Code 與 Codex 對話；含有待接續對話的背景分頁會提早掛載一起恢復，SSH 面板不適用；啟用期間會保留兩個 agent 的狀態 hooks 來記錄 session ID，若原專案目錄已不存在則接續可能失敗 (#260)
- 筆記化身快捷命令庫：狀態列新增快捷命令按鈕，浮動面板列出所有筆記裡的程式碼區塊，依資料夾與筆記分組、可搜尋，點一下就貼進目前的終端機、修改後再自行送出，shell 類區塊另有貼上並執行的動作；筆記的程式碼區塊同時新增貼到終端機按鈕，所有語言（含存 prompt 常用的無語言區塊）都適用，多行內容會落在 agent 的輸入框，不會被逐行送出 (#268, #270)
- 分頁可用滑鼠中鍵關閉，跟瀏覽器與編輯器的慣例一致；有未儲存變更時仍會先跳確認框 (#269)

### fix

- 修正沒有安裝 Homebrew OpenSSL 的 Mac 打不開 app 的問題：內建 git 功能改為不連結外部的 OpenSSL，啟動不再依賴 `/opt/homebrew` 底下的檔案 (#265)
- 修正 Windows 上在終端機輸入 exit 後分頁卡住無法關閉的問題：改為直接偵測 shell 行程結束並主動釋放 pseudo console，不再等待 ConPTY 不會送出的 EOF (#272)

## English

### feat

- New opt-in "AI conversation recovery" setting: when enabled, every tempo-term start resumes each pane's saved Claude Code and Codex conversation in its original pane using its exact session ID; background tabs holding resumable conversations mount eagerly so they recover too, SSH panes are excluded, and both agents' status hooks stay installed while the setting is on to remember session IDs; resume may fail if the original project directory no longer exists (#260)
- Notes now double as a quick command library: a new status bar button opens a floating panel listing every code block saved in notes, grouped by folder and note and searchable; click a row to paste it into the active terminal and submit it yourself, with an extra paste-and-run action on shell blocks. Note code blocks also gain a paste-into-terminal button for every language (including the language-less blocks where prompts usually live), and multi-line content lands in an agent's input box instead of being submitted line by line (#268, #270)
- Tabs can be closed with a middle click, matching browser and editor convention; a tab with unsaved changes still asks for confirmation first (#269)

### fix

- Fix the app failing to launch on Macs without Homebrew's OpenSSL: the built-in git integration no longer links external OpenSSL, so startup no longer depends on anything under `/opt/homebrew` (#265)
- Fix panes hanging on Windows after typing exit in the terminal: shell exit is now detected directly and the pseudo console released proactively, instead of waiting for an EOF that ConPTY never delivers (#272)
