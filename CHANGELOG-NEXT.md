## 正體中文

### feat

- 檔案總管與檔案搜尋支援按住 Cmd／Ctrl 點擊，把檔案開成獨立分頁而不是分割目前的分頁；一般點擊維持原本的分割行為，檔案搜尋按 Enter 時也同樣有效 (#300)

### fix

- 修正分頁與分割視窗的關閉按鈕太相似而容易誤觸的問題：分割視窗的關閉鈕換成不同圖示，滑鼠移上去的顏色也依後果重新分配，紅色留給會關掉整個分頁的那一顆，分頁關閉鈕另外補上提示文字 (#298)

## English

### feat

- Cmd/Ctrl-click a file in the explorer or the file finder to open it in its own tab instead of splitting the active one; a plain click still splits, and the file finder honours the modifier on Enter too (#300)

### fix

- Fix the tab and split-pane close buttons being easy to mistake for each other: the pane button now uses a different icon, the hover colours were swapped so red marks the one that closes the whole tab, and the tab close button gained a tooltip (#298)
