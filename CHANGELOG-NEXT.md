## 正體中文

### feat

### fix
- zsh 指令自動建議在剛開的終端機就會出現，輸入過的指令也會寫回共用的歷史檔，和系統其他終端機互通；先前包裝載入外掛的機制讓 macOS 把歷史檔指到 app 內部的空目錄，導致第一次使用沒有建議、紀錄也不共用

## English

### feat

### fix
- zsh command autosuggestions now show up right away in a freshly opened terminal, and the commands you run are written back to the shared history file so they stay in sync with your other terminals; the plugin wrapper had let macOS point the history file at an empty in-app directory, so first use showed no suggestions and history was not shared
