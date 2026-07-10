# macOS Status IPC Port Implementation Plan (issue #181)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver macOS session status over the loopback IPC path shipped for Windows in #177, retiring the injected `status-hook.sh`, and make hook install idempotent-in-place so a steady-state launch writes zero config files.

**Architecture:** The Windows path (#177) is already platform-neutral at its core: panes get `TEMPOTERM_STATUS_ADDR/TOKEN/PANE_ID` env, Claude/Codex hooks run `"<exe>" --status-hook <state>`, the shim sends one TCP line to a `127.0.0.1` listener, the listener emits a `session-status` Tauri event, the frontend matches `paneId` to the pane. This plan removes the `#[cfg(windows)]` / `IS_WINDOWS` gates so that path runs everywhere, unifies the two install branches into the shim-registering one (which doubles as the migration off `.sh`), and replaces the launch-time uninstall→install churn with a legacy-only cleanup plus skip-write-when-unchanged installs.

**Tech Stack:** Rust (Tauri 2), React + TypeScript, vitest, cargo test.

**Spike results (already verified on a real build, 2026-07-10):** the shim exits in ~30ms before Tauri's builder runs — no Dock icon registers; a quoted app-bundle path with spaces survives `sh -c` and delivers the wire line intact. Neither risk blocks this design.

**What stays:** the frontend OSC 6973 handler (SSH remote panes still deliver in-band over the pty stream) and the 1.2s foreground-poll crash backstop (it already runs only on non-Windows; do not touch it). After this plan, tempo-term itself produces no first-party OSC 6973 — the handler remains as a receiver for remote setups.

## Global Constraints

- Commit messages, code comments, PR text: English (project CLAUDE.md).
- All work on branch `feat/macos-status-ipc` off current `master`; merge via PR, never push master.
- Windows must keep compiling and behaving identically: this plan only widens gates, renames, and reorders writes — any step that would change Windows wire behavior is a plan bug (check against the `windows-tauri` skill pre-flight before commit).
- Rust tests: `cd src-tauri && cargo test --lib`. Frontend: `pnpm test`, `pnpm typecheck`.
- No new dependencies (tempo-term-keep-lightweight).

---

### Task 1: Un-gate the transport (status_ipc, lib.rs setup, pty env injection)

**Files:**
- Modify: `src-tauri/src/modules/status_ipc/mod.rs`
- Modify: `src-tauri/src/lib.rs:165-178`
- Modify: `src-tauri/src/modules/pty/session.rs:105-110, 256-266`

**Interfaces:**
- Produces: `status_ipc::StatusIpc`, `status_ipc::start`, `StatusIpc::env_for` available on all platforms (same signatures as today's Windows-only versions). Later tasks rely on the listener running on macOS.

- [ ] **Step 1: Turn the two Windows-only tests cross-platform (the failing "test")**

In `src-tauri/src/modules/status_ipc/mod.rs`, delete the `#[cfg(windows)]` line above each of these two tests (keep the tests themselves unchanged):

```rust
    #[test]
    fn env_for_carries_addr_token_and_pane_id() {
        let ipc = StatusIpc { addr: "127.0.0.1:5000".into(), token: "tok".into() };
        ...
    }

    #[test]
    fn generated_tokens_are_nonempty_and_vary() {
        ...
    }
```

- [ ] **Step 2: Run tests to verify they fail to compile**

Run: `cd src-tauri && cargo test --lib status_ipc 2>&1 | head -20`
Expected: compile error — `StatusIpc` / `generate_token` not found on macOS (still behind `#[cfg(windows)]`).

- [ ] **Step 3: Un-gate the transport code**

In `src-tauri/src/modules/status_ipc/mod.rs`:

3a. Merge the `TcpListener` import into the ungated use (delete lines 20-21, extend line 18):

```rust
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;
```

3b. Delete these attribute lines entirely (the items they decorate stay):
- `#[cfg_attr(not(windows), allow(dead_code))]` above `STATUS_EVENT` (line 39)
- `#[cfg_attr(not(windows), allow(dead_code))]` above `StatusMessage` (line 46)
- `#[cfg_attr(not(windows), allow(dead_code))]` above `parse_message` (line 57)
- `#[cfg(windows)]` above `StatusIpc` struct (line 90), `impl StatusIpc` (line 96), `start` (line 122), `handle_connection` (line 143), `generate_token` (line 165)

3c. Replace the module doc (lines 1-15) so it no longer claims Windows-only:

```rust
//! Session-status delivery over a loopback socket. Claude Code / Codex hooks
//! run a native shim — this very binary invoked as `tempo-term --status-hook
//! <state>` — that reports the pane's live state to a small TCP listener the
//! app runs on `127.0.0.1`. Originally built for Windows (#155), where hooks
//! run through cmd, which can't execute a bare `.sh`; now the one delivery
//! path on every platform (#181), replacing the injected script + `/dev/$tty`
//! OSC + process-ancestry walk that macOS used to need. The frontend keeps an
//! OSC 6973 handler for SSH remote panes, which still deliver in-band over
//! the pty stream.
//!
//! Correlation: each pane's shell is spawned with `TEMPOTERM_PANE_ID` (the pty
//! session id) and `TEMPOTERM_STATUS_ADDR` in its environment — the same channel
//! that already carries `TEMPOTERM=1`. The hook subprocess inherits them, so the
//! backend knows exactly which pane a status belongs to without walking process
//! ancestry. `TEMPOTERM_STATUS_TOKEN` is a per-run secret the shim echoes back so
//! another local process can't spoof a pane's badge over the open loopback port.
```

3d. Fix the `StatusIpc` struct doc (line 88-89):

```rust
/// Live listener details handed to each pane so its shim can phone home.
pub struct StatusIpc {
```

- [ ] **Step 4: Un-gate the lib.rs setup call**

In `src-tauri/src/lib.rs`, replace lines 165-178 with (removing the `#[cfg(windows)]` and its wrapper braces, updating the comment):

```rust
            // Claude/Codex session status arrives over a loopback socket (#155,
            // ported to all platforms in #181): bind the listener now, before
            // any pane spawns, and stash its address+token so each pane's env
            // can point its status-hook shim back here. A bind failure just
            // leaves status tracking off — never blocks startup.
            match modules::status_ipc::start(app.handle()) {
                Ok(ipc) => {
                    app.manage(ipc);
                }
                Err(err) => eprintln!("status-ipc listener disabled: {err}"),
            }
```

- [ ] **Step 5: Un-gate the pty env injection**

In `src-tauri/src/modules/pty/session.rs`, replace lines 256-266 with:

```rust
    // Hand the pane the loopback address + token + its id so its status-hook
    // shim can report state (see status_ipc).
    let status_env = {
        use tauri::Manager;
        app.try_state::<crate::modules::status_ipc::StatusIpc>()
            .map(|ipc| ipc.env_for(id))
            .unwrap_or_default()
    };
```

And update the comment at lines 105-107 in `build_shell_command`:

```rust
    // Point this pane's status-hook shim back at the app's loopback listener
    // and tag it with the pane's pty id (see status_ipc). Empty when the
    // listener failed to start.
```

- [ ] **Step 6: Run the Rust suite**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS, including the two newly cross-platform tests.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/modules/status_ipc/mod.rs src-tauri/src/lib.rs src-tauri/src/modules/pty/session.rs
git commit -m "feat(status): run the loopback status listener on every platform (#181)"
```

---

### Task 2: Unify the Claude hook install on the shim path, delete status-hook.sh

**Files:**
- Modify: `src-tauri/src/modules/claude_status_hook/mod.rs`
- Delete: `src-tauri/src/modules/claude_status_hook/status-hook.sh`

**Interfaces:**
- Consumes: nothing new.
- Produces: `shim_prefix() -> Result<String, String>` (renamed from `windows_shim_prefix`, un-gated) and `shim_prefix_from_exe(exe: &str) -> String` (renamed from `windows_shim_prefix_from_exe`). `LEGACY_SCRIPT_MARKER` and `SHIM_MARKER` un-gated. Task 3 imports `shim_prefix`, `LEGACY_SCRIPT_MARKER`, `SHIM_MARKER` without cfg.

- [ ] **Step 1: Rename the shim tests and make the legacy-migration test's name platform-neutral (failing tests)**

In the `tests` module of `claude_status_hook/mod.rs`, rename (test bodies unchanged except the two fn-name call sites):
- `windows_shim_prefix_normalizes_backslashes` → `shim_prefix_normalizes_backslashes`, and inside it call `shim_prefix_from_exe(...)` instead of `windows_shim_prefix_from_exe(...)`
- `windows_reinstall_replaces_a_moved_exe_shim` → `reinstall_replaces_a_moved_exe_shim`
- `windows_install_strips_legacy_sh_entry` → `install_strips_legacy_sh_entry`, and reword its comment:

```rust
    #[test]
    fn install_strips_legacy_sh_entry() {
        // A pre-IPC build (any platform — macOS wrote these until #181) left a
        // `.sh` entry; the install's remove-by-LEGACY_SCRIPT_MARKER pass must
        // drop it.
        let legacy = json!({
            "hooks": { "PreToolUse": [
                { "hooks": [{ "type": "command", "command": "C:/Users/me/.claude/tempoterm/status-hook.sh active" }] }
            ]}
        });
        let cleaned = remove_hook_settings(legacy, LEGACY_SCRIPT_MARKER, EVENTS);
        assert!(cleaned.get("hooks").is_none());
    }
```

- `windows_install_dedups_across_slash_styles` → `install_dedups_across_slash_styles` (comment already explains the slash-style scenario; keep it).
- Update the comment above `const SHIM_PREFIX` (line 461-463):

```rust
    // Install registers a native shim command (`"<exe>" --status-hook`), not a
    // `.sh`. These exercise that prefix through the shared merge/remove logic;
    // pure, so they run on every CI runner.
```

- [ ] **Step 2: Run tests to verify they fail to compile**

Run: `cd src-tauri && cargo test --lib claude_status_hook 2>&1 | head -20`
Expected: compile error — `shim_prefix_from_exe` not found (not yet renamed).

- [ ] **Step 3: Rename + un-gate the shim prefix fns, delete the script const**

In `claude_status_hook/mod.rs`:

3a. Delete lines 13-16 (the `HOOK_SCRIPT` doc, `#[cfg_attr(windows, allow(dead_code))]`, and the `include_str!` const) entirely.

3b. Delete the `#[cfg_attr(not(windows), allow(dead_code))]` above `LEGACY_SCRIPT_MARKER` (line 50).

3c. Replace lines 53-72 (both prefix fns and their docs) with:

```rust
/// Build the shim prefix command from an already-resolved executable path.
/// Split out from `shim_prefix` so the string logic is testable without
/// mocking `current_exe()`. Applies `normalize` because Claude Code may run
/// `command` hooks through bash (git-bash on Windows), which treats `\` as an
/// escape and mangles a raw Windows path; forward slashes work in cmd, bash,
/// and sh alike.
fn shim_prefix_from_exe(exe: &str) -> String {
    format!("\"{}\" {SHIM_MARKER}", normalize(exe))
}

/// The command prefix for the native status-hook shim: the app's own
/// executable invoked as `--status-hook`, double-quoted so a path with spaces
/// (e.g. `Program Files`, or a renamed `.app` bundle) survives the hook
/// runner's shell parsing. `merge_hook_settings` appends ` <state>`.
pub fn shim_prefix() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_str().ok_or("executable path is not valid UTF-8")?;
    Ok(shim_prefix_from_exe(exe))
}
```

3d. Rewrite the stale `normalize()` doc (lines 74-83) — the `.sh` script path is gone and the old text contradicted #176's cmd-based rationale:

```rust
/// Canonicalize a hook command for storage and comparison. Hook commands may
/// be executed via cmd or bash depending on the user's setup; bash treats `\`
/// as an escape and mangles raw Windows paths (`C:\Users\...` collapses to
/// `C:Users...`), while forward slashes are accepted by cmd, bash, and sh
/// alike, so we store and match on a single forward-slash form. Applied
/// unconditionally: Unix paths never contain a backslash, so this is
/// effectively a no-op there, and keeping it platform-agnostic lets the dedup
/// logic be tested on any CI runner.
/// `pub(crate)`: `codex_status_hook` mirrors this same normalize-before-match
/// step for its own hooks.json cleanup.
pub(crate) fn normalize(s: &str) -> String {
    s.replace('\\', "/")
}
```

3e. Update the module doc (lines 1-4):

```rust
//! Installs a Claude Code hook that reports the live session state to
//! tempo-term over the loopback status IPC (see `status_ipc`): each hook event
//! runs this very binary as `"<exe>" --status-hook <state>`. The merge/remove
//! of the hook entries in `~/.claude/settings.json` is a pure function over
//! the parsed JSON so it can be tested without touching the filesystem.
```

3f. Update the `our_command` doc (lines 36-38):

```rust
/// Build a hook command from a prefix and the state argument. The prefix is
/// the native shim invocation (`"<exe>" --status-hook`); the state is appended
/// as the final arg.
```

- [ ] **Step 4: Unify the install command**

Replace the whole `claude_status_hook_install` (lines 199-245, both cfg branches and the doc) with:

```rust
/// Register the status hook in settings.json. Idempotent.
///
/// Every platform registers the native shim (`"<exe>" --status-hook <state>`)
/// that reports over loopback (see `status_ipc`); no script is written. Also
/// migrates old installs: removes the legacy `.sh` file a pre-#181 build wrote
/// and strips its settings entries, plus any earlier shim entry (the exe path
/// may have moved between installs).
#[tauri::command]
pub fn claude_status_hook_install(app: AppHandle) -> Result<(), String> {
    let (script_path, settings_path) = paths(&app)?;
    let _ = std::fs::remove_file(&script_path);
    let prefix = shim_prefix()?;
    let cleaned = remove_hook_settings(read_settings(&settings_path)?, LEGACY_SCRIPT_MARKER, EVENTS);
    let cleaned = remove_hook_settings(cleaned, SHIM_MARKER, EVENTS);
    let merged = merge_hook_settings(cleaned, &prefix, EVENTS);
    write_settings(&settings_path, &merged)
}
```

(The skip-write-when-unchanged optimization lands in Task 5, not here.)

- [ ] **Step 5: Un-gate the shim strip in cleanup_settings**

In `cleanup_settings` (lines 257-272), delete the `#[cfg(windows)]` line above the `SHIM_MARKER` strip and update its comment:

```rust
    let cleaned = remove_hook_settings(existing.clone(), &script_path, EVENTS);
    // Our entry may be the native shim rather than the legacy `.sh` path;
    // strip it by its stable marker too (the exe path may have moved since
    // install).
    let cleaned = remove_hook_settings(cleaned, SHIM_MARKER, EVENTS);
```

- [ ] **Step 6: Delete the script file**

```bash
git rm src-tauri/src/modules/claude_status_hook/status-hook.sh
```

- [ ] **Step 7: Run the Rust suite**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS. If anything still references `HOOK_SCRIPT` or `windows_shim_prefix`, it's Task 3's file — fine to see codex compile errors here ONLY if you run before Task 3; in that case do Task 3 Step 1 first, then run. (Safest: complete Task 3 before running the suite, then commit both together — see Task 3 Step 5.)

- [ ] **Step 8: Hold the commit until Task 3 passes** (codex imports break compile otherwise — one commit covers both files).

---

### Task 3: Unify the Codex hook install on the shim path

**Files:**
- Modify: `src-tauri/src/modules/codex_status_hook/mod.rs`

**Interfaces:**
- Consumes: `shim_prefix`, `LEGACY_SCRIPT_MARKER`, `SHIM_MARKER` from Task 2.

- [ ] **Step 1: Fix the imports (lines 10-15)**

```rust
use crate::modules::claude_status_hook::{
    merge_hook_settings, normalize, remove_hook_settings, shim_prefix, LEGACY_SCRIPT_MARKER,
    SHIM_MARKER,
};
```

(Drops the `HOOK_SCRIPT` import and both cfg attributes.)

- [ ] **Step 2: Unify the install command**

Replace the whole `codex_status_hook_install` (lines 71-130, both cfg branches and the doc) with:

```rust
/// Mirror of `claude_status_hook_install`: registers the native shim
/// (`"<exe>" --status-hook`) that reports over loopback (see `status_ipc`),
/// migrating away any legacy `.sh` a pre-#181 build wrote. Also enables
/// Codex's `hooks` feature so it runs the hook.
#[tauri::command]
pub fn codex_status_hook_install(app: AppHandle) -> Result<(), String> {
    let (script_path, hooks_path, config_path) = codex_paths(&app)?;
    // No script file — the shim is our own executable. Remove a stale `.sh` a
    // pre-#181 build may have written.
    let _ = std::fs::remove_file(&script_path);

    // Ensure Codex's hooks feature is on so it runs our shim hook.
    let existing_toml = match std::fs::read_to_string(&config_path) {
        Ok(t) => t,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(err) => return Err(err.to_string()),
    };
    if let Some(dir) = config_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    write_atomic(&config_path, &ensure_hooks_feature(&existing_toml)?)?;

    let prefix = shim_prefix()?;
    // Strip legacy `.sh` and any earlier shim entry, then merge the current one.
    let cleaned = remove_hook_settings(read_json(&hooks_path)?, LEGACY_SCRIPT_MARKER, CODEX_EVENTS);
    let cleaned = remove_hook_settings(cleaned, SHIM_MARKER, CODEX_EVENTS);
    let merged = merge_hook_settings(cleaned, &prefix, CODEX_EVENTS);
    let text = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())? + "\n";
    write_atomic(&hooks_path, &text)
}
```

- [ ] **Step 3: Un-gate the shim strip in cleanup_hooks_json (lines 149-152)**

```rust
    let cleaned = remove_hook_settings(existing.clone(), &script_path, CODEX_EVENTS);
    // Our entry may be the native shim rather than the legacy `.sh` path;
    // strip it by its stable marker too (the exe path may have moved since
    // install).
    let cleaned = remove_hook_settings(cleaned, SHIM_MARKER, CODEX_EVENTS);
```

- [ ] **Step 4: Update the module doc (lines 1-3)**

```rust
//! Installs tempo-term's status hook into Codex's config so Codex sessions
//! report live state over the loopback status IPC, mirroring the Claude
//! installer. Reuses the shared pure merge over hooks.json and ensures
//! Codex's hooks feature flag is on.
```

- [ ] **Step 5: Run the full Rust suite**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS — all claude_status_hook tests (renamed) and codex_status_hook tests green.

- [ ] **Step 6: Commit Tasks 2+3 together**

```bash
git add src-tauri/src/modules/claude_status_hook/ src-tauri/src/modules/codex_status_hook/
git commit -m "feat(status): register the native shim hook on every platform, retire status-hook.sh (#181)"
```

---

### Task 4: Un-gate the frontend session-status listener

**Files:**
- Modify: `src/modules/terminal/TerminalView.tsx:331-363` (and the ref comment at 155-156)

**Interfaces:**
- Consumes: `session-status` Tauri event (now emitted on all platforms after Task 1).

No new component test: `TerminalView` has no test harness today, the change removes one `if`, and `parseStatusOsc` (the logic) is already covered by `sessionStatus.test.ts`. Behavior is verified end-to-end in Task 6.

- [ ] **Step 1: Drop the gate**

Replace lines 331-363 (comment + `if (IS_WINDOWS)` block) with the same code un-wrapped and a rewritten comment:

```tsx
    // Local panes deliver session status over a loopback socket on every
    // platform (#155, #181). The Rust listener (see status_ipc) emits
    // `session-status` tagged with the reporting pane's pty id; match it to
    // this pane and feed the same store. Reconstruct the OSC payload so
    // `parseStatusOsc` stays the single source of truth for the notify→status
    // mapping and validation. The OSC handler above remains the delivery path
    // for SSH remote panes, which report in-band over the pty stream.
    let statusEventUnlisten: (() => void) | undefined;
    let statusEventDisposed = false;
    void listen<{ paneId: number; kind: string; payload: string }>(
      "session-status",
      (event) => {
        if (event.payload.paneId !== ptyIdRef.current) return;
        const leaf = leafIdRef.current;
        if (!leaf) return;
        const parsed = parseStatusOsc(
          `tempoterm;${event.payload.kind};${event.payload.payload}`,
        );
        if (parsed?.kind === "status") {
          useSessionStatusStore.getState().setStatus(leaf, parsed.status);
        } else if (parsed?.kind === "end") {
          useSessionStatusStore.getState().clear(leaf);
        }
      },
    )
      .then((un) => {
        // Race-safe under StrictMode: if the effect already cleaned up before
        // listen() resolved, unsubscribe immediately.
        if (statusEventDisposed) un();
        else statusEventUnlisten = un;
      })
      .catch(() => {});
```

- [ ] **Step 2: Update the ref comment at lines 155-156**

```tsx
  // The backend pty id of this pane's local session, if any. `session-status`
  // IPC events (see status_ipc) are matched back to the pane by this id.
```

- [ ] **Step 3: Leave untouched (verify only, no edit):** the OSC 6973 handler (lines 315-329) and the 1.2s foreground-poll backstop in the cwd-tracking effect (`else` branch with `setInterval(..., 1200)`). `IS_WINDOWS` stays imported (still used by the OSC 7 cwd branch).

- [ ] **Step 4: Typecheck + frontend tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (`IS_WINDOWS` must not become an unused import — it won't, the OSC 7 branch uses it).

- [ ] **Step 5: Commit**

```bash
git add src/modules/terminal/TerminalView.tsx
git commit -m "feat(status): listen for session-status IPC events on every platform (#181)"
```

---

### Task 5: Idempotent-in-place install + legacy-only launch cleanup

Today's launch flow churns: `.setup()` unconditionally uninstalls (one write), then App.tsx reinstalls when tracking is on (second write) — every launch. After this task: installs skip the write when settings are already correct, and the launch-time pass only migrates legacy `.sh` remnants (touching nothing once migrated), so a steady-state launch writes zero config files. The tracking-off user's cleanup path (the reason lib.rs:190 exists — see its comment) is preserved: legacy `.sh` entries still get stripped for them; shim entries only ever exist if they once enabled tracking, and toggling off runs the full uninstall (WorkspaceSettingsSection.tsx:120).

**Files:**
- Modify: `src-tauri/src/modules/claude_status_hook/mod.rs`
- Modify: `src-tauri/src/modules/codex_status_hook/mod.rs`
- Modify: `src-tauri/src/lib.rs:180-195`

**Interfaces:**
- Produces: `claude_status_hook::claude_status_hook_cleanup_legacy(app: AppHandle) -> Result<(), String>` and `codex_status_hook::codex_status_hook_cleanup_legacy(app: AppHandle) -> Result<(), String>` (plain fns, NOT tauri commands), called from `lib.rs` setup on all platforms.

- [ ] **Step 1: Write the failing tests (claude side)**

Append to the `tests` module of `claude_status_hook/mod.rs`:

```rust
    #[test]
    fn install_skips_rewrite_when_settings_already_correct() {
        // Steady state: settings already hold exactly our current shim entries.
        // A reinstall must not rewrite the file (no mtime churn, no re-sorted
        // keys, no race with Claude Code's own writes).
        let dir = temp_dir_for("install-noop");
        let settings_path = dir.join("settings.json");
        let merged = merge_hook_settings(json!({}), SHIM_PREFIX, EVENTS);
        let original = serde_json::to_string_pretty(&merged).unwrap() + "\n";
        std::fs::write(&settings_path, &original).unwrap();

        install_into(&settings_path, SHIM_PREFIX).unwrap();

        let after = std::fs::read_to_string(&settings_path).unwrap();
        assert_eq!(after, original, "an already-correct settings.json must be left byte-identical");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_writes_when_settings_are_missing_our_entries() {
        let dir = temp_dir_for("install-fresh");
        let settings_path = dir.join("settings.json");
        std::fs::write(&settings_path, "{}\n").unwrap();

        install_into(&settings_path, SHIM_PREFIX).unwrap();

        let after: Value = serde_json::from_str(&std::fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert_eq!(
            after["hooks"]["PreToolUse"][0]["hooks"][0]["command"],
            format!("{SHIM_PREFIX} active")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cleanup_legacy_strips_sh_entries_but_keeps_shim_entries() {
        // The launch-time pass must migrate legacy `.sh` entries away without
        // touching current shim entries — otherwise every launch would undo
        // the install and force a rewrite (the churn this task removes).
        let dir = temp_dir_for("legacy-only");
        let settings_path = dir.join("settings.json");
        let with_shim = merge_hook_settings(json!({}), SHIM_PREFIX, EVENTS);
        let with_both = merge_hook_settings(with_shim, "/Users/me/.claude/tempoterm/status-hook.sh", EVENTS);
        std::fs::write(&settings_path, serde_json::to_string_pretty(&with_both).unwrap()).unwrap();

        cleanup_legacy_entries(&settings_path).unwrap();

        let after: Value = serde_json::from_str(&std::fs::read_to_string(&settings_path).unwrap()).unwrap();
        let cmds: Vec<&str> = after["hooks"]["PreToolUse"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|e| e["hooks"][0]["command"].as_str())
            .collect();
        assert_eq!(cmds, vec![format!("{SHIM_PREFIX} active")]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cleanup_legacy_skips_rewrite_when_no_sh_entries_exist() {
        // Post-migration steady state: nothing legacy left. The file must come
        // out byte-identical, launch after launch.
        let dir = temp_dir_for("legacy-noop");
        let settings_path = dir.join("settings.json");
        let merged = merge_hook_settings(json!({}), SHIM_PREFIX, EVENTS);
        let original = serde_json::to_string_pretty(&merged).unwrap() + "\n";
        std::fs::write(&settings_path, &original).unwrap();

        cleanup_legacy_entries(&settings_path).unwrap();

        let after = std::fs::read_to_string(&settings_path).unwrap();
        assert_eq!(after, original);

        let _ = std::fs::remove_dir_all(&dir);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib claude_status_hook 2>&1 | head -20`
Expected: compile error — `install_into` / `cleanup_legacy_entries` not defined.

- [ ] **Step 3: Implement (claude side)**

3a. Split the file-level install out of the command so it's testable without an `AppHandle`, with the skip-write compare:

```rust
/// File-level install: reconcile `settings_path` to hold exactly our current
/// shim entries (stripping legacy `.sh` and moved-exe shim entries), writing
/// only when the result differs from what's on disk — a steady-state launch
/// must not touch the file at all (no mtime churn, no re-sorted keys, no race
/// with Claude Code's own writes). Split from the command for testability.
fn install_into(settings_path: &PathBuf, prefix: &str) -> Result<(), String> {
    let existing = read_settings(settings_path)?;
    let cleaned = remove_hook_settings(existing.clone(), LEGACY_SCRIPT_MARKER, EVENTS);
    let cleaned = remove_hook_settings(cleaned, SHIM_MARKER, EVENTS);
    let merged = merge_hook_settings(cleaned, prefix, EVENTS);
    if merged == existing {
        return Ok(());
    }
    write_settings(settings_path, &merged)
}
```

Then shrink the command (which Task 2 unified) to:

```rust
#[tauri::command]
pub fn claude_status_hook_install(app: AppHandle) -> Result<(), String> {
    let (script_path, settings_path) = paths(&app)?;
    let _ = std::fs::remove_file(&script_path);
    let prefix = shim_prefix()?;
    install_into(&settings_path, &prefix)
}
```

(Keep the doc comment Task 2 wrote on the command, adding one line: `/// Steady state is a no-op: the file is only written when its content would change.`)

3b. Add the legacy-only cleanup pair:

```rust
/// Strip only legacy `.sh` hook entries from `settings_path`, leaving current
/// shim entries alone; skip the rewrite when nothing legacy exists. This is
/// the launch-time migration pass (see `claude_status_hook_cleanup_legacy`):
/// unlike `cleanup_settings` it must never remove the live shim entries, or
/// every launch would undo the install and reintroduce the write churn.
fn cleanup_legacy_entries(settings_path: &PathBuf) -> Result<(), String> {
    if !settings_path.exists() {
        return Ok(());
    }
    let existing = read_settings(settings_path)?;
    let cleaned = remove_hook_settings(existing.clone(), LEGACY_SCRIPT_MARKER, EVENTS);
    if cleaned != existing {
        write_settings(settings_path, &cleaned)?;
    }
    Ok(())
}

/// Launch-time migration off the pre-#181 `.sh` delivery: strip legacy
/// settings entries and delete the script file. Runs on every platform, every
/// launch, independent of the user's `claudeStatusTracking` setting — a user
/// who disabled tracking (so install never runs) still gets migrated. Called
/// from `lib.rs`'s `.setup()`; steady state touches nothing.
pub fn claude_status_hook_cleanup_legacy(app: AppHandle) -> Result<(), String> {
    let (script_path, settings_path) = paths(&app)?;
    cleanup_legacy_entries(&settings_path)?;
    let _ = std::fs::remove_file(&script_path);
    if let Some(dir) = script_path.parent() {
        let _ = std::fs::remove_dir(dir); // best-effort, only succeeds when empty
    }
    Ok(())
}
```

- [ ] **Step 4: Run claude-side tests**

Run: `cd src-tauri && cargo test --lib claude_status_hook`
Expected: PASS (4 new tests green).

- [ ] **Step 5: Write the failing tests (codex side)**

Append to the `tests` module of `codex_status_hook/mod.rs`:

```rust
    const SHIM_PREFIX: &str = r#""C:/Program Files/TempoTerm/tempo-term.exe" --status-hook"#;

    #[test]
    fn codex_install_into_skips_rewrite_when_already_correct() {
        let dir = temp_dir_for("install-noop");
        let hooks_path = dir.join("hooks.json");
        let merged = merge_hook_settings(json!({}), SHIM_PREFIX, CODEX_EVENTS);
        let original = serde_json::to_string_pretty(&merged).unwrap() + "\n";
        std::fs::write(&hooks_path, &original).unwrap();

        install_into(&hooks_path, SHIM_PREFIX).unwrap();

        let after = std::fs::read_to_string(&hooks_path).unwrap();
        assert_eq!(after, original, "an already-correct hooks.json must be left byte-identical");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn codex_cleanup_legacy_strips_sh_but_keeps_shim() {
        let dir = temp_dir_for("legacy-only");
        let hooks_path = dir.join("hooks.json");
        let with_shim = merge_hook_settings(json!({}), SHIM_PREFIX, CODEX_EVENTS);
        let with_both = merge_hook_settings(with_shim, "/Users/me/.codex/tempoterm/status-hook.sh", CODEX_EVENTS);
        std::fs::write(&hooks_path, serde_json::to_string_pretty(&with_both).unwrap()).unwrap();

        cleanup_legacy_entries(&hooks_path).unwrap();

        let after: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&hooks_path).unwrap()).unwrap();
        let cmds: Vec<&str> = after["hooks"]["PreToolUse"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|e| e["hooks"][0]["command"].as_str())
            .collect();
        assert_eq!(cmds, vec![format!("{SHIM_PREFIX} active")]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn codex_config_toml_is_not_rewritten_when_hooks_already_enabled() {
        // ensure_hooks_feature is a no-op on already-correct input; the install
        // must then skip the config.toml write too (same churn rule as JSON).
        let dir = temp_dir_for("toml-noop");
        let config_path = dir.join("config.toml");
        let original = "[features]\nhooks = true\n";
        std::fs::write(&config_path, original).unwrap();
        let before = std::fs::metadata(&config_path).unwrap().modified().unwrap();

        ensure_hooks_feature_at(&config_path).unwrap();

        let after_meta = std::fs::metadata(&config_path).unwrap().modified().unwrap();
        let after = std::fs::read_to_string(&config_path).unwrap();
        assert_eq!(after, original);
        assert_eq!(before, after_meta, "config.toml must not be rewritten when already correct");

        let _ = std::fs::remove_dir_all(&dir);
    }
```

- [ ] **Step 6: Run to verify they fail to compile**

Run: `cd src-tauri && cargo test --lib codex_status_hook 2>&1 | head -20`
Expected: compile error — `install_into` / `cleanup_legacy_entries` / `ensure_hooks_feature_at` not defined in codex module.

- [ ] **Step 7: Implement (codex side)**

7a. Extract the config.toml ensure into a skip-write helper:

```rust
/// Ensure `[features] hooks = true` in the config.toml at `config_path`,
/// writing only when the text actually changes (toml_edit preserves
/// formatting, so already-correct input round-trips byte-identical).
fn ensure_hooks_feature_at(config_path: &Path) -> Result<(), String> {
    let existing = match std::fs::read_to_string(config_path) {
        Ok(t) => t,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(err) => return Err(err.to_string()),
    };
    let updated = ensure_hooks_feature(&existing)?;
    if updated == existing {
        return Ok(());
    }
    if let Some(dir) = config_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    write_atomic(config_path, &updated)
}
```

7b. File-level install with skip-write, mirroring claude:

```rust
/// File-level install: reconcile `hooks_path` to hold exactly our current shim
/// entries, writing only when the result differs from what's on disk (see
/// `claude_status_hook::install_into` for why). Split for testability.
fn install_into(hooks_path: &Path, prefix: &str) -> Result<(), String> {
    let existing = read_json(hooks_path)?;
    let cleaned = remove_hook_settings(existing.clone(), LEGACY_SCRIPT_MARKER, CODEX_EVENTS);
    let cleaned = remove_hook_settings(cleaned, SHIM_MARKER, CODEX_EVENTS);
    let merged = merge_hook_settings(cleaned, prefix, CODEX_EVENTS);
    if merged == existing {
        return Ok(());
    }
    let text = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())? + "\n";
    write_atomic(hooks_path, &text)
}
```

Then shrink the command (from Task 3) to:

```rust
#[tauri::command]
pub fn codex_status_hook_install(app: AppHandle) -> Result<(), String> {
    let (script_path, hooks_path, config_path) = codex_paths(&app)?;
    let _ = std::fs::remove_file(&script_path);
    ensure_hooks_feature_at(&config_path)?;
    let prefix = shim_prefix()?;
    install_into(&hooks_path, &prefix)
}
```

(Keep Task 3's doc comment on the command, adding: `/// Steady state is a no-op: files are only written when their content would change.`)

7c. Legacy cleanup pair:

```rust
/// Strip only legacy `.sh` hook entries from `hooks_path`, leaving current
/// shim entries alone; skip the rewrite when nothing legacy exists. Mirrors
/// `claude_status_hook::cleanup_legacy_entries`.
fn cleanup_legacy_entries(hooks_path: &Path) -> Result<(), String> {
    if !hooks_path.exists() {
        return Ok(());
    }
    let existing = read_json(hooks_path)?;
    let cleaned = remove_hook_settings(existing.clone(), LEGACY_SCRIPT_MARKER, CODEX_EVENTS);
    if cleaned != existing {
        let text = serde_json::to_string_pretty(&cleaned).map_err(|e| e.to_string())? + "\n";
        write_atomic(hooks_path, &text)?;
    }
    Ok(())
}

/// Launch-time migration off the pre-#181 `.sh` delivery for Codex; see
/// `claude_status_hook_cleanup_legacy`. Leaves `[features] hooks = true`
/// alone — other tools (e.g. CodeIsland) rely on it.
pub fn codex_status_hook_cleanup_legacy(app: AppHandle) -> Result<(), String> {
    let (script_path, hooks_path, _config_path) = codex_paths(&app)?;
    cleanup_legacy_entries(&hooks_path)?;
    let _ = std::fs::remove_file(&script_path);
    if let Some(dir) = script_path.parent() {
        let _ = std::fs::remove_dir(dir);
    }
    Ok(())
}
```

- [ ] **Step 8: Swap the lib.rs launch call**

In `src-tauri/src/lib.rs`, add to the imports (near lines 15-16):

```rust
use modules::claude_status_hook::claude_status_hook_cleanup_legacy;
use modules::codex_status_hook::codex_status_hook_cleanup_legacy;
```

Replace the launch-cleanup block (lines 180-195, comment + `#[cfg(target_os = "windows")]` + uninstall calls) with:

```rust
            // Migrate old installs off the pre-#181 `.sh` status hooks: strip
            // their config entries and delete the script, on every platform,
            // independent of the `claudeStatusTracking` setting — the only
            // launch-time caller of install is gated on that setting (see
            // App.tsx), so a user who disabled tracking would otherwise never
            // get migrated. Legacy-only and skip-write-when-clean, so a
            // migrated machine's launch touches no config file.
            {
                let handle = app.handle().clone();
                let _ = claude_status_hook_cleanup_legacy(handle.clone());
                let _ = codex_status_hook_cleanup_legacy(handle);
            }
```

- [ ] **Step 9: Run the full Rust suite**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS — all new tests green, no test still references the uninstall-at-launch flow.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/modules/claude_status_hook/mod.rs src-tauri/src/modules/codex_status_hook/mod.rs src-tauri/src/lib.rs
git commit -m "feat(status): make hook install idempotent in place, migrate legacy .sh at launch (#181)"
```

---

### Task 6: Full verification (typecheck, suites, live E2E on macOS)

**Files:** none (verification only).

- [ ] **Step 1: Full local gates**

Run: `cd src-tauri && cargo test --lib && cargo clippy -- -D warnings 2>&1 | tail -5; cd .. && pnpm typecheck && pnpm test`
Expected: all green. (If clippy flags pre-existing unrelated warnings, note them, don't fix in this branch.)

- [ ] **Step 2: Live E2E (the /verify step — drive the real flow)**

1. `pnpm tauri dev`
2. In a pane: `env | grep TEMPOTERM` → expect `TEMPOTERM=1`, `TEMPOTERM_STATUS_ADDR=127.0.0.1:<port>`, `TEMPOTERM_STATUS_TOKEN=<token>`, `TEMPOTERM_PANE_ID=<id>`.
3. Check `~/.claude/settings.json` after enabling tracking: hooks point at `"<dev exe>" --status-hook <state>`, no `status-hook.sh` entries, `~/.claude/tempoterm/` gone.
4. Run `claude` in the pane, ask it something: workspace card badge must light (thinking → active → idle), with NO Dock icon flash on state changes.
5. Quit and relaunch the dev app; check `settings.json` mtime does not change on the second launch (steady-state zero-write).
6. If an SSH remote is handy: confirm a remote pane with the OSC-emitting setup still lights the badge (OSC path intact). Skippable if no remote configured — note it in the PR.

- [ ] **Step 3: Windows regression sanity (no Windows box locally)**

Confirm by inspection + CI: no `#[cfg(windows)]` remains around the status path except none-needed; `cargo check --target x86_64-pc-windows-msvc` if the toolchain is installed, else rely on the `windows-build.yml` CI on the PR. Walk the `windows-tauri` skill pre-flight list for the touched files.

- [ ] **Step 4: PR**

Per project convention (branch → PR, English, conventional title, label/milestone/assignee, then check gemini-code-assist review):

```bash
git push -u origin feat/macos-status-ipc
gh pr create --title "feat(status): port macOS session status to the loopback IPC path, retire status-hook.sh" --body "<summary per git-workflow.md, closes #181>"
MILESTONE=$(gh api repos/mukiwu/tempo-term/milestones --jq '.[0].title')
gh pr edit <n> --add-label enhancement --milestone "$MILESTONE" --add-assignee mukiwu
```

---

## Self-Review Notes

- **Spec coverage** (issue #181 work sketch → tasks): status_ipc un-gate → Task 1; lib.rs un-gate → Task 1; pty env un-gate → Task 1; install registers shim + rename + delete script + rewrite tests → Tasks 2-3; TerminalView gate drop, keep OSC + backstop → Task 4; idempotent-in-place install (open item) → Task 5; stale normalize() doc + test names (riding-along) → Task 2; Dock-flash + quoting open items → pre-verified by spike, re-checked live in Task 6.
- **Deliberate deviations from the sketch:** none in behavior; the launch cleanup becomes legacy-only rather than deleted, preserving the tracking-off migration path that lib.rs:180's comment documents.
- **Windows behavior audit:** install output identical (same markers, same prefix builder, now skip-write — a pure optimization); launch cleanup narrows from full-uninstall to legacy-only — the full uninstall remains available via the settings toggle, and the #155 dialog-storm entries are `.sh` entries, which legacy cleanup still strips.
- **Type consistency:** `install_into(&PathBuf, &str)` (claude) vs `install_into(&Path, &str)` (codex) — each matches its module's existing path idiom (`cleanup_settings(&PathBuf, ...)` vs `write_atomic(&Path, ...)`); names are module-local (not exported), so the asymmetry can't leak.
