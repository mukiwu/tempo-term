Run a comprehensive full-codebase audit for a Tauri 2 app.

Scans the entire codebase (not just git diff) across two dimensions simultaneously:
- **Security** — capabilities, permissions, command input validation, CSP, isolation
- **Performance** — IPC payload, async commands, state contention, startup time

## Execution

Launch **two agents in parallel**, each scanning the full codebase:

1. **`tauri-security-reviewer`** — Read `.claude/skills/tauri-security-review/SKILL.md`, then scan: `src-tauri/capabilities/**/*.json`, `src-tauri/permissions/**/*.toml`, `src-tauri/tauri.conf.json`, all files containing `#[tauri::command]`, `invoke_handler!`, `tauri::Builder`, frontend files using `@tauri-apps/api/core`'s `invoke()`.

2. **`tauri-performance-reviewer`** — Read `.claude/skills/tauri-performance-review/SKILL.md`, then scan all Rust commands for: `serde_json::to_string` on large data, missing `Channel` for streaming, `std::sync::Mutex` held across `.await`, blocking I/O in async commands, frontend bundle size in `tauri.conf.json`, dev URL config.

Each agent should use the **Grep tool** (not bash grep/rg) and the **Read tool** for deep inspection.

## Consolidation

After both agents complete, merge findings into a single report sorted by severity:

```
# Tauri Full Audit Report
Date: {today}
Scope: Full codebase

## Summary

| Severity | Security | Performance | Total |
|----------|----------|-------------|-------|
| CRITICAL | 0        | 0           | 0     |
| HIGH     | 0        | 0           | 0     |
| MEDIUM   | 0        | 0           | 0     |
| LOW      | 0        | 0           | 0     |
| **Total**| 0        | 0           | **0** |

**Overall verdict: PASS / WARNING / BLOCK**

---

## Issues (sorted by severity)

### #1 [CRITICAL / Security] Issue Title
**File:** `src-tauri/src/commands/files.rs:18`
**Category:** Security — Input Validation
**Issue:** Description.
**Fix:** Concrete fix.

---

## Recommended Fix Order

1. All Security CRITICAL — privilege escalation / data leak
2. Security HIGH — fix before merge
3. Performance CRITICAL / HIGH — user-visible jank, fix before merge
4. MEDIUM — follow-up tickets
5. LOW — backlog
```

## Usage

```
/tauri-audit
```

Best for: quarterly health checks, major version bumps, onboarding to existing Tauri codebases.
