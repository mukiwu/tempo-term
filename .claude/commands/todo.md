---
description: Execute Tauri development tasks from a spec file. Handles Rust commands, capabilities, and frontend invoke calls. Optional skills and TDD mode.
invokes_agent: tauri-task-executor
---

# Todo Command

Execute development tasks defined in a spec file with Tauri-aware conventions.

## Syntax

```bash
/todo <spec-file> [@skill...] [--tdd[=type]]
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `<spec-file>` | Yes | Path to spec (e.g., `spec/notes-editor/autosave.md`) |
| `@skill` | No | Additional skill (`@tauri`, `@tauri-security-review`, etc.) |
| `--tdd` | No | Test-driven development mode |

## TDD Mode Options

| Option | Description |
|--------|-------------|
| `--tdd` | Auto-detect (Rust unit / Vitest / Playwright) |
| `--tdd=rust` | Rust `#[cfg(test)]` unit tests via `cargo test` |
| `--tdd=unit` | Frontend unit tests (Vitest) |
| `--tdd=e2e` | E2E with WebDriver (`tauri-driver`) or Playwright |

## TDD 工作流程（紅-綠-重構）

```
┌─────────────────────────────────────────────────────────────┐
│  1. RED — 撰寫失敗的測試                                     │
│     ├── Rust: #[cfg(test)] mod tests { #[test] fn ... }     │
│     ├── 前端: Vitest 或 Playwright                            │
│     └── 執行測試確認失敗（紅燈）                              │
├─────────────────────────────────────────────────────────────┤
│  2. GREEN — 撰寫最小可行程式碼                                │
│     └── 執行測試確認通過（綠燈）                              │
├─────────────────────────────────────────────────────────────┤
│  3. REFACTOR — 重構（可選）                                   │
└─────────────────────────────────────────────────────────────┘
```

### 測試類型選擇指南

| 測試類型 | 適用場景 | 工具 | 檔案位置 |
|---------|---------|------|---------|
| **Rust unit** | command 邏輯、純函數、error 轉換 | `cargo test` | `src-tauri/src/**/mod.rs` 內 `#[cfg(test)]` |
| **Frontend unit** | UI hooks、純函數、`invoke()` wrapper | Vitest | `tests/unit/*.unit.spec.ts` |
| **E2E** | 完整 IPC 流程、視窗互動 | Playwright + tauri-driver | `tests/e2e/*.e2e.spec.ts` |

## Available Skills

| Skill | Use Case |
|-------|----------|
| `@tauri` | Tauri 2 commands、capabilities、permissions、state |
| `@tauri-security-review` | IPC、CSP、scope、input validation |
| `@tauri-performance-review` | IPC payload、async commands、state contention |

> **Note**: `@tauri` 會自動載入。

## Examples

```bash
/todo spec/notes-editor/autosave.md
/todo spec/file-watcher/core.md @tauri --tdd=rust
/todo spec/export/pdf.md @tauri @tauri-security-review --tdd
```

## Test Commands

| Command | Description |
|---------|-------------|
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust 單元測試 |
| `pnpm test:unit` | 前端單元測試 (Vitest) |
| `pnpm test:e2e` | E2E 測試 |
| `pnpm tauri build --debug` | 確認可編譯 |

## Related

- `/plan` — 建立 spec
- `/tauri-check` — diff-based 自動審查
- Agent: `.claude/agents/tauri-task-executor.md`
- Skills: `.claude/skills/tauri/`
