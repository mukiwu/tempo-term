//! Installs a Claude Code hook that reports the live session state to tempo-term
//! as an OSC sequence (see `status-hook.sh`). The merge/remove of the hook
//! entries in `~/.claude/settings.json` is a pure function over the parsed JSON
//! so it can be tested without touching the filesystem.

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::modules::claude_progress::config_base_dir;

/// The hook script body, embedded so install can write it to disk.
pub const HOOK_SCRIPT: &str = include_str!("status-hook.sh");

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

fn our_command(script_path: &str, state: &str) -> String {
    format!("{script_path} {state}")
}

/// Canonicalize a hook command (or our script path) for storage and comparison.
/// On Windows the script path is built with backslashes, but Claude Code runs
/// `command` hooks through bash, which treats `\` as an escape and mangles the
/// path (`C:\Users\...` collapses to `C:Users...`, so the hook can't be found).
/// Git Bash accepts forward slashes, so we store and match on a single
/// forward-slash form. Applied unconditionally: Unix paths never contain a
/// backslash, so this is effectively a no-op there, and keeping it
/// platform-agnostic lets the dedup logic be tested on any CI runner.
fn normalize(s: &str) -> String {
    s.replace('\\', "/")
}

/// Add our hook entry to each event without disturbing the user's own hooks.
/// Idempotent: re-running never duplicates our entries.
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

/// Write the hook script and register its entries in settings.json. Idempotent.
#[tauri::command]
pub fn claude_status_hook_install(app: AppHandle) -> Result<(), String> {
    let (script_path, settings_path) = paths(&app)?;
    if let Some(dir) = script_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&script_path, HOOK_SCRIPT).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    let script_str = script_path.to_str().ok_or("script path is not valid UTF-8")?;
    // Canonicalize to forward slashes so the command bash runs is valid on Windows
    // and has one stable form (see `normalize`).
    let script_str = normalize(script_str);
    let script_str = script_str.as_str();
    // Remove our existing entries first, then merge fresh. This migrates installs
    // from older versions whose command arguments differed (e.g. Notification
    // used to pass "waiting-approval") or whose path used backslashes; a plain
    // merge would leave those stale entries behind alongside the new ones.
    let cleaned = remove_hook_settings(read_settings(&settings_path)?, script_str, EVENTS);
    let merged = merge_hook_settings(cleaned, script_str, EVENTS);
    write_settings(&settings_path, &merged)
}

/// Remove our settings.json entries and delete the hook script.
#[tauri::command]
pub fn claude_status_hook_uninstall(app: AppHandle) -> Result<(), String> {
    let (script_path, settings_path) = paths(&app)?;
    let script_str = script_path.to_str().ok_or("script path is not valid UTF-8")?;
    // Match on the same forward-slash form install wrote (see `normalize`), so we
    // also clean up entries left by older backslash installs.
    let script_str = normalize(script_str);
    let script_str = script_str.as_str();
    // Only rewrite settings.json if it already exists, so uninstalling never
    // creates an empty `{}` file for a user who has no settings.
    if settings_path.exists() {
        let cleaned = remove_hook_settings(read_settings(&settings_path)?, script_str, EVENTS);
        write_settings(&settings_path, &cleaned)?;
    }
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
    fn windows_install_dedups_across_slash_styles() {
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
}
