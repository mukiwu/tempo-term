Run a Tauri 2 security review on the current git diff.

Launch the `tauri-security-reviewer` agent to execute the review.

Focus areas: capability scope (`src-tauri/capabilities/*.json`), permission least-privilege, custom command input validation, fs/shell/http scope restriction, CSP in `tauri.conf.json`, isolation pattern, IPC trust boundary, plugin allowlist.

When to use: after each commit push, especially when modifying `src-tauri/`, capabilities, permissions, `tauri.conf.json`, or any `#[tauri::command]` function.
