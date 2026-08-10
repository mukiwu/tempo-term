## 正體中文

### feat

- Windows 上的 Git Bash 面板現在也會回報工作目錄，在裡面 `cd` 檔案總管會跟著切換；先前只有 PowerShell 和 cmd.exe 有這個同步 (#312)
- 外觀設定新增自訂背景圖片，可預覽、保存或拖曳替換 PNG、JPEG、WebP，調整介面與終端機圖片透明度、文字顏色，並選擇只套用於工作區或延伸至整個視窗 (#305)
- 檔案總管的路徑列改成可點選的麵包屑，跟終端機標題列一樣：點任一段會列出該目錄的子目錄、可就地展開下一層，選一個就把檔案總管切換到那裡（作用中的終端機也會一併 cd）；遠端 (SSH) 根目錄同樣適用 (#310)
- Claude Code 與 Codex 的狀態回報現在會留下紀錄，寫在應用程式資料夾的 `status-hook.log`，每個 hook 事件一行，記下時間、面板編號、agent、狀態，以及送出成功或失敗的原因。回報狀態圖示不會更新的問題時附上這個檔案，就能直接分辨是 hook 根本沒被執行、連不上應用程式，還是送出之後才出問題 (#320)
- Windows 上的 `Ctrl+B`、`Ctrl+P`、`Ctrl+N` 改為交給終端機。這三組在終端機裡本來就有用途，`Ctrl+B` 是 tmux 的 prefix 與 Claude Code 的背景執行，`Ctrl+P` 與 `Ctrl+N` 是 readline 的上下一筆歷史，先前會被應用程式攔走。對應功能改用 `Ctrl+Shift+B` 開關左側欄、`Ctrl+Shift+P` 搜尋檔案、`Ctrl+Shift+N` 開新視窗；`Ctrl+W`、`Ctrl+T`、`Ctrl+D` 的 Shift 位置已有其他功能，這次維持原狀。macOS 不受影響 (#318)

### fix

- 修正整個視窗模式下終端機重複套用遮罩的問題 (#305)
- Windows 上寫進 Codex 的 hook 指令改用反斜線路徑。Codex 在 Windows 是透過 `cmd.exe` 執行 hook，先前寫入的正斜線路徑在那裡不一定跑得起來，安裝在含空白的資料夾（例如 `Program Files`）時特別容易失敗。Claude Code 那條維持正斜線不變，因為它走的是 bash (#321)
- 修正 macOS 上 `Ctrl+T`、`Ctrl+P`、`Ctrl+,`、`Ctrl+D` 會誤觸應用程式功能的問題。這幾組在終端機裡是控制碼，先前按一次會同時送出控制碼並執行應用程式動作，例如 `Ctrl+D` 送出 EOF 的同時把窗格分割掉；現在一律留給終端機，應用程式快捷鍵維持用 `Cmd` (#317)

### 貢獻者

- @yw-chan (#312, #310)
- @mark22013333 (#305)

## English

### feat

- Git Bash panes on Windows now report their working directory, so `cd` moves the file explorer with them — previously only PowerShell and cmd.exe were wired up (#312)
- Add app-managed PNG, JPEG, or WebP background images in Appearance settings, with pre-commit preview, drag-to-replace, separate interface and terminal opacity, custom text colour, and workspace or whole-window scope (#305)
- The explorer's path row is now a clickable breadcrumb, like a terminal pane header's: click a segment to list that directory's subdirectories, expand a level in place, and pick one to re-root the explorer there (the active terminal cds along); remote (SSH) roots work the same way (#310)
- Claude Code and Codex status reporting now leaves a trail: `status-hook.log` in the app data folder gets one line per hook event, recording the time, pane, agent, state, and whether the report was delivered or why it was not. Attaching it to a report about a stuck status icon shows straight away whether the hook never ran, could not reach the app, or failed after delivery (#320)
- `Ctrl+B`, `Ctrl+P` and `Ctrl+N` now reach the shell on Windows instead of being claimed by the app. All three already mean something in a terminal — `Ctrl+B` is tmux's prefix and Claude Code's background-run key, `Ctrl+P` and `Ctrl+N` walk readline history. The app actions moved to `Ctrl+Shift+B` (left sidebar), `Ctrl+Shift+P` (find files) and `Ctrl+Shift+N` (new window). `Ctrl+W`, `Ctrl+T` and `Ctrl+D` keep their bindings for now, since their Shift slots are already taken. macOS is unaffected (#318)

### fix

- Fix duplicate terminal wallpaper masks in whole-window mode (#305)
- The Codex hook command written on Windows now uses a backslash path. Codex runs hooks through `cmd.exe` there, where the forward-slash path we used to write is not reliably executable — most visibly for installs in a folder with a space in it, such as `Program Files`. The Claude Code entry keeps forward slashes, since it goes through bash (#321)
- Fix `Ctrl+T`, `Ctrl+P`, `Ctrl+,` and `Ctrl+D` firing app actions on macOS. They are terminal control codes, so a single press used to send the byte and run the app action together — `Ctrl+D` sent EOF to the shell while splitting the pane. They now belong to the terminal; the app's shortcuts stay on `Cmd` (#317)

### Contributors

- @yw-chan (#312, #310)
- @mark22013333 (#305)
