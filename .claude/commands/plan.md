---
description: Create Tauri implementation plan using 3-layer task breakdown. Covers Rust backend, IPC capabilities, and frontend integration. WAIT for user CONFIRM before touching any code.
invokes_agent: tauri-planner
---

# Plan Command

Create a comprehensive Tauri 2 implementation plan before writing any code. Output considers Rust commands, IPC capabilities, and frontend integration.

## When to Use

- Starting a new Tauri feature (new window, new command, new plugin)
- Adding a system integration (filesystem, shell, notifications, etc.)
- Architectural changes that touch IPC or capabilities

## Syntax

```bash
/plan Build a markdown notes editor with autosave
/plan @tauri Build a folder watcher feature
/plan @tauri-security-review Add a file export feature
```

## What the planner will check

1. **Rust side** — which `#[tauri::command]` to add, state, error types, async vs sync.
2. **IPC surface** — required permissions and which capability file (`src-tauri/capabilities/*.json`) the window needs.
3. **Frontend side** — `invoke()` calls, types, error handling.
4. **Plugin choice** — official plugin (`tauri-plugin-fs`, `tauri-plugin-shell`, etc.) vs custom command.

## Output

Plan saved to `spec/[feature-name]/`:
- `overview.md` — master index
- `[major-feature].md` — per-feature breakdown including Rust tasks, capability JSON snippets, and frontend tasks.

## Related

- Agent: `.claude/agents/tauri-planner.md`
- Skills: `.claude/skills/tauri/`
