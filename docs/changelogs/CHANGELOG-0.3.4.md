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
- 修正 Windows 上點麵包屑的磁碟機代號時，開出來的不是該磁碟根目錄的問題。先前產生的位置是不帶反斜線的 `C:`，那在 Windows 代表「C 槽目前所在的目錄」而不是根目錄，因此會列出毫不相干的資料夾，之後每一次點選都跟著錯下去；編輯器麵包屑列出同層檔案時也有同樣狀況。macOS 與 Linux 不受影響 (#322)
- 修正從側邊欄開檔案、筆記或 SSH 連線時，會把自己排好的窗格佈局壓平的問題。先前每次開啟都會把整個分頁重排成等寬欄位，上下疊放的窗格因此全部翻成左右並排，而且不只新增的那格，整個分頁裡的分割都被改寫。現在只有還維持預設排列的分頁會重排，自己動過的分頁保留原樣，新窗格接在旁邊，連開幾次每格也維持平均大小 (#323)

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
- Fix a Windows breadcrumb opening a drive's current directory instead of the drive root. The crumb used to carry a bare `C:`, which on Windows means "wherever this process sits on drive C:" rather than the root, so it listed an unrelated folder and every click after it inherited the mistake. The editor breadcrumb's sibling-file menu had the same problem. macOS and Linux are unaffected (#322)
- Opening a file, note, or SSH entry from the sidebar no longer flattens a pane layout you arranged yourself. Every open used to rebuild the whole tab as equal columns, so panes stacked top to bottom all flipped to side by side — and not just the one being added, every split in the tab was rewritten. Tabs still in the default arrangement rearrange as before; one you have split yourself keeps its shape, takes the new pane alongside, and stays evenly divided however many you open (#323)

### Contributors

- @yw-chan (#312, #310)
- @mark22013333 (#305)
