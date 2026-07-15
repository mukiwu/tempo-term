## 正體中文

### feat

- Windows 自繪標題列強化：icon 與應用程式名稱現在可以直接拖曳視窗；選單列在視窗變窄或放大時放不下的項目會自動收進溢位選單（…），含層疊子選單，靠近視窗右緣時自動翻向，不會被切掉 (#207)
- AI 助理可對接自訂 OpenAI 相容端點：內建新增 LM Studio 預設，並加入 Custom 選項讓你自填 base URL，串接 oMLX、vLLM 或任何 OpenAI 相容伺服器（本機端點免金鑰，遠端端點可選填金鑰）；同時新增 gpt-5.6-sol、gpt-5.6-terra、gpt-5.6-luna 三個 OpenAI 模型 (#153, #211)
- setup 精靈新增偵測 fnm 管理的 node 版本底下安裝的 CLI 工具，涵蓋 macOS、Linux 與 Windows (#212)

### fix

- 修正 setup 精靈在 GUI 啟動時偵測不到安裝在 nvm、volta、asdf 底下的 CLI 工具（如 Claude、Codex）的問題；這些路徑只存在於 shell 的 PATH，圖形介面啟動時繼承不到 (#206)
- 修正 Windows 上按 Ctrl+N 或 File > New Window 會跳出一個黑色、無法關閉的空視窗，且之後快捷鍵全部失效的問題；根因是 WebView2 在同步指令中建立視窗會造成死鎖 (#208, #209)
- 修正 Windows 上切換到其他應用程式再切回來時，鍵盤焦點消失、要用滑鼠再點一次視窗才能打字的問題 (#205, #210)

### 感謝

- 感謝 @yw-chan 貢獻 Windows 標題列拖曳與選單列溢位選單（#207），以及 fnm 工具偵測（#212）

## English

### feat

- Windows custom title bar improvements: the icon and app name can now drag the window, and menu-bar items that don't fit collapse into an overflow menu (…) with cascading submenus that flip away from the screen edge so they are never clipped (#207)
- The AI assistant can talk to custom OpenAI-compatible endpoints: a new LM Studio preset plus a Custom option let you enter a base URL for oMLX, vLLM or any OpenAI-compatible server (keyless for local endpoints, an optional key for remote ones); also adds the gpt-5.6-sol, gpt-5.6-terra and gpt-5.6-luna models (#153, #211)
- The setup wizard now detects CLI tools installed under fnm-managed node versions, across macOS, Linux and Windows (#212)

### fix

- Fix the setup wizard failing to detect CLI tools (Claude, Codex, and others) installed under nvm, volta or asdf when launched from the GUI: those paths only live on the shell PATH, which a GUI launch does not inherit (#206)
- Fix Ctrl+N / File > New Window on Windows opening a blank, unclosable window and then killing every subsequent shortcut: building a WebView2 window inside a synchronous command deadlocks the event loop (#208, #209)
- Fix keyboard focus disappearing on Windows after switching to another app and back, which forced a click before you could type again (#205, #210)

### Thanks

- Thanks to @yw-chan for the Windows title-bar dragging and menu overflow (#207) and the fnm tool detection (#212)
