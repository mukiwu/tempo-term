## 正體中文

### feat

- Git Graph 搜尋時會直接標出每一列命中的位置，命中哪個欄位就標哪個，並且可以逐筆導覽 (#442)
- Diff 的折疊區塊會標出它接進哪一段程式，並可以往上或往下一次展開二十行，或一次全開 (#430)
- Git Graph 還有歷史可以載入時，parent 不在這一頁的線會從節點一路畫到頁尾，不再停在半空中 (#441)

### fix

- 修正 macOS 15 以下完全開不起來的問題，Apple Intelligence 的框架改為弱連結，系統上沒有就不去載入；那台機器上除了 Apple Intelligence 以外的功能都照常 (#448)

### 貢獻者

- @yw-chan (#430, #441, #442)
- @fdjkgh580 (#448)

## English

### feat

- Mark what a graph search matched, in whichever field carried it, and step the matches one at a time (#442)
- Name the code a collapsed stretch in a diff leads into, and open it twenty lines at a time, up or down, or all at once (#430)
- Carry a graph line from its node to the foot of the page while there is more history to load (#441)

### fix

- Open on macOS 15 and earlier again: the Apple Intelligence framework is weak-linked, so a Mac without it simply does not load it, and everything but Apple Intelligence works as before (#448)

### Contributors

- @yw-chan (#430, #441, #442)
- @fdjkgh580 (#448)
