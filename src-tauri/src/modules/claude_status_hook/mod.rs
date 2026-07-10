//! Installs a Claude Code hook that reports the live session state to
//! tempo-term over the loopback status IPC (see `status_ipc`): each hook event
//! runs this very binary as `"<exe>" --status-hook <state>`. The merge/remove
//! of the hook entries in `~/.claude/settings.json` is a pure function over
//! the parsed JSON so it can be tested without touching the filesystem.

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::modules::claude_progress::config_base_dir;

/// (Claude Code hook event, status argument) pairs we install. The argument is
/// the state passed to the hook script, except `Notification` passes the
/// sentinel `notification`: that event is a catch-all (permission prompt, idle
/// prompt, auth, elicitation, …), so the script reads its `notification_type`
/// off stdin and forwards it for the app to resolve. `PermissionRequest` is the
/// precise approval signal; `PostToolUse` returns to active so the badge
/// recovers right after a tool (e.g. one that needed approval) finishes.
const EVENTS: &[(&str, &str)] = &[
    ("SessionStart", "idle"),
    ("UserPromptSubmit", "thinking"),
    ("PreToolUse", "active"),
    ("PostToolUse", "active"),
    ("PermissionRequest", "waiting-approval"),
    ("Notification", "notification"),
    ("Stop", "idle"),
    ("SessionEnd", "end"),
];

/// Build a hook command from a prefix and the state argument. The prefix is
/// the native shim invocation (`"<exe>" --status-hook`); the state is appended
/// as the final arg.
fn our_command(prefix: &str, state: &str) -> String {
    format!("{prefix} {state}")
}

/// Substring identifying our native status-hook shim command in settings.json
/// (`"<exe>" --status-hook <state>`). Used to strip stale shim entries on
/// reinstall/uninstall no matter where the executable now lives.
pub const SHIM_MARKER: &str = "--status-hook";

/// Substring identifying the legacy Unix `.sh` hook command, so install/uninstall
/// also cleans up entries a pre-IPC build wrote.
pub const LEGACY_SCRIPT_MARKER: &str = "status-hook.sh";

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

/// Add our hook entry to each event without disturbing the user's own hooks.
/// Idempotent: re-running never duplicates our entries. `script_path` is the
/// command prefix (the `.sh` path on Unix, the shim invocation on Windows).
pub fn merge_hook_settings(mut existing: Value, script_path: &str, events: &[(&str, &str)]) -> Value {
    if !existing.is_object() {
        existing = json!({});
    }
    let root = existing.as_object_mut().unwrap();
    let hooks = root.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().unwrap();
    for (event, state) in events {
        let cmd = our_command(script_path, state);
        let arr = hooks.entry(*event).or_insert_with(|| json!([]));
        if !arr.is_array() {
            *arr = json!([]);
        }
        let arr = arr.as_array_mut().unwrap();
        let already = arr.iter().any(|e| {
            e["hooks"].as_array().is_some_and(|hs| {
                hs.iter().any(|h| h["command"] == Value::String(cmd.clone()))
            })
        });
        if !already {
            arr.push(json!({ "hooks": [{ "type": "command", "command": cmd }] }));
        }
    }
    existing
}

/// Remove only the entries whose command points at our script, then drop any
/// event array we left empty. The user's other hooks are untouched.
/// `script_path` must already be normalized (see `normalize`); each stored
/// command is normalized before comparison so stale backslash entries still match.
pub fn remove_hook_settings(mut existing: Value, script_path: &str, events: &[(&str, &str)]) -> Value {
    let Some(hooks) = existing.get_mut("hooks").and_then(Value::as_object_mut) else {
        return existing;
    };
    for (event, _) in events {
        if let Some(arr) = hooks.get_mut(*event).and_then(Value::as_array_mut) {
            arr.retain(|e| {
                e["hooks"].as_array().is_none_or(|hs| {
                    !hs.iter().any(|h| {
                        h["command"]
                            .as_str()
                            .is_some_and(|c| normalize(c).contains(script_path))
                    })
                })
            });
        }
    }
    let empty: Vec<String> = hooks
        .iter()
        .filter(|(_, v)| v.as_array().is_some_and(|a| a.is_empty()))
        .map(|(k, _)| k.clone())
        .collect();
    for key in empty {
        hooks.remove(&key);
    }
    // Drop the whole `hooks` key if nothing is left, rather than leaving an
    // empty `"hooks": {}` block in the user's settings.
    let hooks_empty = hooks.is_empty();
    if hooks_empty {
        if let Some(root) = existing.as_object_mut() {
            root.remove("hooks");
        }
    }
    existing
}

/// `~/.claude` (or the CLAUDE_CONFIG_DIR override), the script path under it,
/// and the settings.json path. Shared by install and uninstall.
fn paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let env_value = std::env::var("CLAUDE_CONFIG_DIR").ok();
    let base = config_base_dir(&home, env_value.as_deref());
    let script_path = base.join("tempoterm").join("status-hook.sh");
    let settings_path = base.join("settings.json");
    Ok((script_path, settings_path))
}

/// Read and parse settings.json, treating a missing file as `{}`. A malformed
/// existing file is an error so we never clobber it.
fn read_settings(settings_path: &PathBuf) -> Result<Value, String> {
    match std::fs::read_to_string(settings_path) {
        Ok(text) if text.trim().is_empty() => Ok(json!({})),
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("settings.json is not valid JSON: {e}")),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(err) => Err(err.to_string()),
    }
}

fn write_settings(settings_path: &PathBuf, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    // Write to a sibling temp file then rename, so an interrupted write can
    // never leave the user's settings.json half-written. Clean up the temp file
    // on either failure so we don't leave garbage in the config directory.
    let tmp_path = settings_path.with_extension("json.tmp");
    if let Err(err) = std::fs::write(&tmp_path, text + "\n") {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(err.to_string());
    }
    if let Err(err) = std::fs::rename(&tmp_path, settings_path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(err.to_string());
    }
    Ok(())
}

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

/// Register the status hook in settings.json. Idempotent.
///
/// Every platform registers the native shim (`"<exe>" --status-hook <state>`)
/// that reports over loopback (see `status_ipc`); no script is written. Also
/// migrates old installs: removes the legacy `.sh` file a pre-#181 build wrote
/// and strips its settings entries, plus any earlier shim entry (the exe path
/// may have moved between installs).
/// Steady state is a no-op: the file is only written when its content would change.
#[tauri::command]
pub fn claude_status_hook_install(app: AppHandle) -> Result<(), String> {
    let (script_path, settings_path) = paths(&app)?;
    let _ = std::fs::remove_file(&script_path);
    let prefix = shim_prefix()?;
    install_into(&settings_path, &prefix)
}

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

/// Remove our entries from the settings file at `settings_path`, skipping the
/// rewrite entirely when nothing changed. `raw_script_path` need not be
/// pre-normalized: it is normalized internally (see `normalize`) before
/// matching, so entries are found regardless of which slash style
/// `script_path.to_str()` produced (e.g. an old Windows build's backslash
/// path) — PR #176 review Fix 1. Only rewrites when an entry was actually
/// removed, so a file with nothing of ours in it (the common case on every
/// launch) is never touched — no re-sorted keys, no race with Claude Code's
/// own writes — PR #176 review Fix 3. A missing file is a no-op, so
/// uninstalling never creates an empty `{}` file for a user with no settings.
fn cleanup_settings(settings_path: &PathBuf, raw_script_path: &str) -> Result<(), String> {
    if !settings_path.exists() {
        return Ok(());
    }
    let script_path = normalize(raw_script_path);
    let existing = read_settings(settings_path)?;
    let cleaned = remove_hook_settings(existing.clone(), &script_path, EVENTS);
    // Our entry may be the native shim rather than the legacy `.sh` path;
    // strip it by its stable marker too (the exe path may have moved since
    // install).
    let cleaned = remove_hook_settings(cleaned, SHIM_MARKER, EVENTS);
    if cleaned != existing {
        write_settings(settings_path, &cleaned)?;
    }
    Ok(())
}

/// Remove our settings.json entries and delete the legacy hook script. Only
/// invoked from the frontend when the user turns status tracking off; the
/// launch-time migration path is `claude_status_hook_cleanup_legacy`.
#[tauri::command]
pub fn claude_status_hook_uninstall(app: AppHandle) -> Result<(), String> {
    let (script_path, settings_path) = paths(&app)?;
    let script_str = script_path.to_str().ok_or("script path is not valid UTF-8")?;
    cleanup_settings(&settings_path, script_str)?;
    let _ = std::fs::remove_file(&script_path);
    if let Some(dir) = script_path.parent() {
        let _ = std::fs::remove_dir(dir); // best-effort, only succeeds when empty
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_adds_entries_without_touching_other_hooks() {
        let existing = json!({
            "hooks": { "PreToolUse": [{ "hooks": [{ "type": "command", "command": "user-thing" }] }] }
        });
        let merged = merge_hook_settings(existing, "/p/status-hook.sh", EVENTS);
        let pre = merged["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| e["hooks"][0]["command"] == "user-thing"));
        assert!(pre
            .iter()
            .any(|e| e["hooks"][0]["command"] == "/p/status-hook.sh active"));
        assert!(merged["hooks"]["SessionEnd"].as_array().unwrap().iter().any(|e| {
            e["hooks"][0]["command"] == "/p/status-hook.sh end"
        }));
    }

    #[test]
    fn remove_strips_only_our_entries() {
        let merged = merge_hook_settings(
            json!({
                "hooks": { "PreToolUse": [{ "hooks": [{ "type": "command", "command": "user-thing" }] }] }
            }),
            "/p/status-hook.sh",
            EVENTS,
        );
        let cleaned = remove_hook_settings(merged, "/p/status-hook.sh", EVENTS);
        let pre = cleaned["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| e["hooks"][0]["command"] == "user-thing"));
        assert!(!pre.iter().any(|e| e["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .contains("status-hook.sh")));
        assert!(cleaned["hooks"].get("SessionEnd").is_none());
    }

    #[test]
    fn merge_is_idempotent() {
        let once = merge_hook_settings(json!({}), "/p/status-hook.sh", EVENTS);
        let twice = merge_hook_settings(once.clone(), "/p/status-hook.sh", EVENTS);
        assert_eq!(once, twice);
    }

    #[test]
    fn remove_drops_the_hooks_key_when_it_becomes_empty() {
        // Settings whose only hooks are ours: after removal nothing is left, so
        // the whole "hooks" key should be gone rather than left as "hooks": {}.
        let merged = merge_hook_settings(json!({}), "/p/status-hook.sh", EVENTS);
        let cleaned = remove_hook_settings(merged, "/p/status-hook.sh", EVENTS);
        assert!(cleaned.get("hooks").is_none());
    }

    #[test]
    fn remove_on_settings_without_our_hooks_is_safe() {
        let other = json!({ "hooks": { "PreToolUse": [{ "hooks": [{ "type": "command", "command": "user" }] }] } });
        let cleaned = remove_hook_settings(other.clone(), "/p/status-hook.sh", EVENTS);
        assert_eq!(cleaned, other);
    }

    fn temp_dir_for(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tt-claude-hook-cleanup-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // --- cleanup_settings: PR #176 review findings ---------------------------

    #[test]
    fn cleanup_settings_skips_rewrite_when_nothing_to_remove() {
        // Fix 3: a settings.json with no tempo-term entries must come out
        // byte-identical, including key order. serde_json has no preserve_order
        // feature, so any unconditional rewrite would re-sort these keys
        // alphabetically even though nothing changed — that's the bug.
        let dir = temp_dir_for("noop");
        let settings_path = dir.join("settings.json");
        let original = "{\n  \"zeta\": 1,\n  \"alpha\": 2\n}\n";
        std::fs::write(&settings_path, original).unwrap();

        cleanup_settings(&settings_path, "/p/status-hook.sh").unwrap();

        let after = std::fs::read_to_string(&settings_path).unwrap();
        assert_eq!(after, original, "file with nothing to remove must be left byte-identical");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cleanup_settings_rewrites_when_an_entry_is_actually_removed() {
        let dir = temp_dir_for("changed");
        let settings_path = dir.join("settings.json");
        let merged = merge_hook_settings(json!({}), "/p/status-hook.sh", EVENTS);
        std::fs::write(&settings_path, serde_json::to_string_pretty(&merged).unwrap()).unwrap();

        cleanup_settings(&settings_path, "/p/status-hook.sh").unwrap();

        let after: Value = serde_json::from_str(&std::fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert!(after.get("hooks").is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_installs_notification_and_posttooluse_entries() {
        let merged = merge_hook_settings(json!({}), "/p/status-hook.sh", EVENTS);
        // Notification forwards its type via the "notification" sentinel, not a
        // hard-coded waiting-approval.
        let notif = merged["hooks"]["Notification"].as_array().unwrap();
        assert!(notif
            .iter()
            .any(|e| e["hooks"][0]["command"] == "/p/status-hook.sh notification"));
        // PostToolUse returns to active.
        let post = merged["hooks"]["PostToolUse"].as_array().unwrap();
        assert!(post
            .iter()
            .any(|e| e["hooks"][0]["command"] == "/p/status-hook.sh active"));
    }

    #[test]
    fn reinstall_migrates_stale_argument_entries() {
        // An older install left Notification pointing at "waiting-approval".
        // The install sequence (remove then merge) must replace it, not stack a
        // second entry, so idle prompts stop lighting waiting-approval.
        let stale = json!({
            "hooks": {
                "Notification": [
                    { "hooks": [{ "type": "command", "command": "/p/status-hook.sh waiting-approval" }] }
                ]
            }
        });
        let migrated =
            merge_hook_settings(remove_hook_settings(stale, "/p/status-hook.sh", EVENTS), "/p/status-hook.sh", EVENTS);
        let notif = migrated["hooks"]["Notification"].as_array().unwrap();
        let commands: Vec<&str> = notif
            .iter()
            .filter_map(|e| e["hooks"][0]["command"].as_str())
            .collect();
        assert!(commands.contains(&"/p/status-hook.sh notification"));
        assert!(!commands.contains(&"/p/status-hook.sh waiting-approval"));
    }

    #[test]
    fn install_dedups_across_slash_styles() {
        // An older Windows install wrote the command with backslashes, which bash
        // can't run (C:\Users\... collapses to C:Users...). The install sequence
        // (remove then merge) must strip that stale entry and leave exactly one
        // forward-slash entry per event, not stack a second one beside it.
        // `normalize` is platform-agnostic, so this runs (and guards regressions)
        // on every CI runner, not just Windows.
        let canonical = "C:/Users/me/.claude/tempoterm/status-hook.sh";
        let stale = json!({
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": r"C:\Users\me\.claude\tempoterm\status-hook.sh active" }] }
                ]
            }
        });
        let cleaned = remove_hook_settings(stale, canonical, EVENTS);
        let merged = merge_hook_settings(cleaned, canonical, EVENTS);
        let cmds: Vec<&str> = merged["hooks"]["PreToolUse"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|e| e["hooks"][0]["command"].as_str())
            .collect();
        assert_eq!(cmds, vec!["C:/Users/me/.claude/tempoterm/status-hook.sh active"]);
    }

    // Install registers a native shim command (`"<exe>" --status-hook`), not a
    // `.sh`. These exercise that prefix through the shared merge/remove logic;
    // pure, so they run on every CI runner.
    const SHIM_PREFIX: &str = r#""C:\Program Files\TempoTerm\tempo-term.exe" --status-hook"#;

    #[test]
    fn shim_prefix_produces_quoted_exe_command() {
        let merged = merge_hook_settings(json!({}), SHIM_PREFIX, EVENTS);
        assert_eq!(
            merged["hooks"]["PreToolUse"][0]["hooks"][0]["command"],
            format!("{SHIM_PREFIX} active")
        );
        // Notification still forwards the sentinel the shim resolves off stdin.
        assert_eq!(
            merged["hooks"]["Notification"][0]["hooks"][0]["command"],
            format!("{SHIM_PREFIX} notification")
        );
    }

    #[test]
    fn shim_marker_strips_our_entry_regardless_of_exe_path() {
        let merged = merge_hook_settings(json!({}), SHIM_PREFIX, EVENTS);
        let cleaned = remove_hook_settings(merged, SHIM_MARKER, EVENTS);
        assert!(cleaned.get("hooks").is_none());
    }

    #[test]
    fn reinstall_replaces_a_moved_exe_shim() {
        // A prior install pointed the shim at an old exe path; reinstall (remove
        // by marker, then merge) must leave exactly one entry at the new path.
        let old = merge_hook_settings(json!({}), r#""C:\old\tempo-term.exe" --status-hook"#, EVENTS);
        let cleaned = remove_hook_settings(old, SHIM_MARKER, EVENTS);
        let merged = merge_hook_settings(cleaned, r#""C:\new\tempo-term.exe" --status-hook"#, EVENTS);
        let cmds: Vec<&str> = merged["hooks"]["PreToolUse"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|e| e["hooks"][0]["command"].as_str())
            .collect();
        assert_eq!(cmds, vec![r#""C:\new\tempo-term.exe" --status-hook active"#]);
    }

    #[test]
    fn shim_prefix_normalizes_backslashes() {
        // Claude Code runs `command` hooks through bash on a git-bash setup; a
        // raw backslash path (`C:\Program Files\...`) gets its backslashes eaten
        // as escapes and the shim never runs. The prefix must be built on the
        // same forward-slash form as the script-path flows (see `normalize`).
        let prefix = shim_prefix_from_exe(r"C:\Program Files\TempoTerm\tempo-term.exe");
        assert_eq!(prefix, r#""C:/Program Files/TempoTerm/tempo-term.exe" --status-hook"#);
    }

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
}
