## 正體中文

### feat

- Windows 上的 Git Bash 面板現在也會回報工作目錄，在裡面 `cd` 檔案總管會跟著切換；先前只有 PowerShell 和 cmd.exe 有這個同步 (#312)
- 外觀設定新增自訂背景圖片，可預覽、保存或拖曳替換 PNG、JPEG、WebP，調整介面與終端機圖片透明度、文字顏色，並選擇只套用於工作區或延伸至整個視窗 (#305)
- 檔案總管的路徑列改成可點選的麵包屑，跟終端機標題列一樣：點任一段會列出該目錄的子目錄、可就地展開下一層，選一個就把檔案總管切換到那裡（作用中的終端機也會一併 cd）；遠端 (SSH) 根目錄同樣適用 (#310)

### fix

- 修正整個視窗模式下終端機重複套用遮罩的問題 (#305)
- 修正 macOS 上 `Ctrl+T`、`Ctrl+P`、`Ctrl+,`、`Ctrl+D` 會誤觸應用程式功能的問題。這幾組在終端機裡是控制碼，先前按一次會同時送出控制碼並執行應用程式動作，例如 `Ctrl+D` 送出 EOF 的同時把窗格分割掉；現在一律留給終端機，應用程式快捷鍵維持用 `Cmd` (#317)

### 貢獻者

- @yw-chan (#312, #310)
- @mark22013333 (#305)

## English

### feat

- Git Bash panes on Windows now report their working directory, so `cd` moves the file explorer with them — previously only PowerShell and cmd.exe were wired up (#312)
- Add app-managed PNG, JPEG, or WebP background images in Appearance settings, with pre-commit preview, drag-to-replace, separate interface and terminal opacity, custom text colour, and workspace or whole-window scope (#305)
- The explorer's path row is now a clickable breadcrumb, like a terminal pane header's: click a segment to list that directory's subdirectories, expand a level in place, and pick one to re-root the explorer there (the active terminal cds along); remote (SSH) roots work the same way (#310)

### fix

- Fix duplicate terminal wallpaper masks in whole-window mode (#305)
- Fix `Ctrl+T`, `Ctrl+P`, `Ctrl+,` and `Ctrl+D` firing app actions on macOS. They are terminal control codes, so a single press used to send the byte and run the app action together — `Ctrl+D` sent EOF to the shell while splitting the pane. They now belong to the terminal; the app's shortcuts stay on `Cmd` (#317)

### Contributors

- @yw-chan (#312, #310)
- @mark22013333 (#305)
