Run targeted Tauri reviews based on what files have changed.

自動偵測修改檔案（staged + unstaged），只啟動相關的 review agents，避免不必要的 review 與 token 浪費。

## Steps

1. **Detect changes** — Run `git diff --name-only` and `git diff --staged --name-only`.

2. **Determine which reviews to run** based on changed file paths:

   | File pattern | Agent to launch |
   |---|---|
   | `src-tauri/capabilities/*.json`, `src-tauri/permissions/*.toml`, `src-tauri/tauri.conf.json` (security 區塊), `#[tauri::command]` 函數，`invoke_handler!` 註冊變動 | `tauri-security-reviewer` |
   | Rust 命令邏輯（資料量大、async/await、Mutex、Channel、Response），前端 `invoke()` 高頻呼叫，`tauri.conf.json` 的 bundle/dev 設定 | `tauri-performance-reviewer` |

3. **Launch only matched agents in parallel.** 沒符合的 pattern 就回報 "No Tauri-related changes detected — no review needed."

4. **Consolidate results** — 多個 agent 跑完後，依嚴重度合併：

```
## Tauri Check Results

Reviews triggered: Security ✅ | Performance ✅

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0     | ✅ pass |
| HIGH     | 0     | ✅ pass |
| MEDIUM   | 0     | ℹ️ info |
| LOW      | 0     | 📝 note |

**Verdict: PASS / WARNING / BLOCK**

---
(依嚴重度列出 issues)
```

## Usage

```
/tauri-check
```

完成程式碼變更後、`git commit` 之前執行。有問題就修，再跑一次直到 PASS。
