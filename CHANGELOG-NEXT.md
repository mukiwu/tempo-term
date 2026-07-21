## 正體中文

### feat

- 新增 AI 對話恢復設定（預設關閉）：開啟後每次啟動 tempo-term，會用精確的 session ID 在原分頁與面板自動接續已儲存的 Claude Code 與 Codex 對話；含有待接續對話的背景分頁會提早掛載一起恢復，SSH 面板不適用；啟用期間會保留兩個 agent 的狀態 hooks 來記錄 session ID，若原專案目錄已不存在則接續可能失敗 (#260)

### fix

## English

### feat

- New opt-in "AI conversation recovery" setting: when enabled, every tempo-term start resumes each pane's saved Claude Code and Codex conversation in its original pane using its exact session ID; background tabs holding resumable conversations mount eagerly so they recover too, SSH panes are excluded, and both agents' status hooks stay installed while the setting is on to remember session IDs; resume may fail if the original project directory no longer exists (#260)

### fix
