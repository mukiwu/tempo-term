## 正體中文

### feat

- Git Graph 的分支篩選器改成可搜尋的多選，可同時把多條分支的歷史畫在同一張圖上對照；清單按各分支最後一次 commit 的時間排序，並標出目前簽出的分支 (#333)
- Windows 上編輯器與 diff 的捲軸改為 VS Code 式擺法，橫向捲軸貼齊面板底部並從行號欄右側開始，不再壓在行號下方；diff 兩側的橫向捲動改為同步，這部分所有平台皆生效 (#327)

### fix

- 修正 Git Graph 選定分支後篩選失效的問題。先前即使指定了分支，仍會併入所有遠端分支與標籤的歷史，畫出來的圖與顯示全部幾乎相同 (#333)
- 修正選取範圍跨過游標所在行時，該行的選取反白被當前行高亮蓋掉的問題 (#328)
- 修正套用自訂背景圖時，行號欄底色疊色過深、在程式碼區旁形成一條明顯深色直帶的問題 (#342)
- AI 對話側邊欄的操作按鈕改為閒置時收合，不再佔用行寬，標題可用滿整列；滑鼠移入或鍵盤聚焦時展開，並套用整列高亮 (#338, #339)

### 貢獻者

- @yw-chan (#327, #328, #333, #338)

## English

### feat

- The Git Graph branch filter is now a searchable multi-select, so several branches can be graphed together for comparison; the list is ordered by each branch's last commit time and marks the checked-out branch (#333)
- Editor and diff scrollbars on Windows now follow the VS Code layout, with the horizontal bar pinned to the pane's bottom and starting after the line-number gutter instead of running beneath it; the two diff sides also scroll horizontally in lockstep, which applies on every platform (#327)

### fix

- Fix the Git Graph branch filter having almost no effect. Picking a branch still unioned in the history of every remote branch and tag, so the graph looked much the same as Show All (#333)
- Fix a selection that spans the cursor's line having its highlight hidden there by the active-line background (#328)
- Fix the line-number gutter compounding its tint over a custom background image, showing up as a darker vertical stripe beside the code (#342)
- Sessions sidebar action buttons collapse when idle instead of reserving row width, giving titles the full row; they expand on hover or keyboard focus, with the highlight spanning the whole row (#338, #339)

### Contributors

- @yw-chan (#327, #328, #333, #338)
