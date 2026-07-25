## 正體中文

### feat

- 終端機支援原生 OSC 8 檔案超連結：Claude Code 等 CLI 印出的檔案連結，按住修飾鍵點擊就能直接在編輯器分割窗開啟，長路徑因換行斷開也不受影響；會向 shell 宣告支援讓 CLI 改輸出原生連結，並擋下偽裝成本機檔案的 UNC 與遠端目標 (#243, #280)
- 版本控制面板的 Staged changes、Changes、Recent commits 三個區段可以收合：整條標題列都是點擊目標並支援鍵盤操作，Changes 收合時 Stage all 按鈕仍可直接使用，Recent commits 收合時會釘在面板底部 (#277, #282)

### fix

- 修正 git graph 裡分支尾端併回主線時，分支的線會蓋在主線上的問題：分支現在沿自己的軌道畫到底、貼著匯入的 commit 才彎進去，多條分支併進同一個 commit 也各走各的軌道 (#274)

## English

### feat

- The terminal now supports native OSC 8 file hyperlinks: file links printed by CLIs like Claude Code open directly in an editor split on modifier-click, unaffected by long paths wrapping across lines; the shell is told hyperlinks are supported so CLIs emit them, and UNC or remote targets disguised as local files are rejected (#243, #280)
- The source control panel's Staged changes, Changes and Recent commits sections are collapsible: the whole header row is the click target and works from the keyboard, Stage all stays usable while Changes is collapsed, and Recent commits pins to the bottom of the panel while collapsed (#277, #282)

### fix

- Fix branch tails overdrawing the trunk in the git graph when merging back: a branch now runs down its own lane and only bends in right at its parent commit, and multiple branches joining the same commit each keep their own lane (#274)
