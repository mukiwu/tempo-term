//! Installs tempo-term's status hook into Codex's config so Codex sessions
//! report live state as OSC, mirroring the Claude installer. Reuses the shared
//! pure merge over hooks.json and ensures Codex's hooks feature flag is on.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use toml_edit::{DocumentMut, Item, Table, value};

use crate::modules::claude_status_hook::{merge_hook_settings, normalize, remove_hook_settings};
// The `.sh` body is only written on Unix; Windows registers the native shim.
#[cfg(not(windows))]
use crate::modules::claude_status_hook::HOOK_SCRIPT;
#[cfg(windows)]
use crate::modules::claude_status_hook::{windows_shim_prefix, LEGACY_SCRIPT_MARKER, SHIM_MARKER};

/// Codex hook event to status argument. No `Notification` catch-all: Codex signals
/// approval directly via `PermissionRequest`.
const CODEX_EVENTS: &[(&str, &str)] = &[
    ("SessionStart", "idle"),
    ("UserPromptSubmit", "thinking"),
    ("PreToolUse", "active"),
    ("PostToolUse", "active"),
    ("PermissionRequest", "waiting-approval"),
    ("Stop", "idle"),
    ("SessionEnd", "end"),
];

/// `~/.codex` (or the `CODEX_HOME` override). Returns the script path, the
/// hooks.json path, and the config.toml path.
fn codex_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let base = match std::env::var("CODEX_HOME") {
        Ok(v) if !v.trim().is_empty() => {
            let p = Path::new(&v);
            p.strip_prefix("~").map(|rest| home.join(rest)).unwrap_or_else(|_| p.to_path_buf())
        }
        _ => home.join(".codex"),
    };
    Ok((
        base.join("tempoterm").join("status-hook.sh"),
        base.join("hooks.json"),
        base.join("config.toml"),
    ))
}

fn read_json(path: &Path) -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => Ok(serde_json::json!({})),
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("hooks.json is not valid JSON: {e}")),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(err) => Err(err.to_string()),
    }
}

fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let tmp = path.with_file_name(format!(
        "{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy()
    ));
    if let Err(err) = std::fs::write(&tmp, text) {
        let _ = std::fs::remove_file(&tmp);
        return Err(err.to_string());
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Mirror of `claude_status_hook_install`. Unix writes the `.sh` and points the
/// hook at it; Windows registers the native shim (`"<exe>" --status-hook`) that
/// reports over loopback (see `status_ipc`), because cmd can't run a bare `.sh`
/// (#155). Either way Codex's `hooks` feature is enabled so it runs the hook.
#[tauri::command]
pub fn codex_status_hook_install(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (script_path, hooks_path, config_path) = codex_paths(&app)?;
        // No script file on Windows — remove a stale `.sh` a pre-IPC build wrote.
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

        let prefix = windows_shim_prefix()?;
        // Strip legacy `.sh` and any earlier shim entry, then merge the current one.
        let cleaned = remove_hook_settings(read_json(&hooks_path)?, LEGACY_SCRIPT_MARKER, CODEX_EVENTS);
        let cleaned = remove_hook_settings(cleaned, SHIM_MARKER, CODEX_EVENTS);
        let merged = merge_hook_settings(cleaned, &prefix, CODEX_EVENTS);
        let text = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())? + "\n";
        return write_atomic(&hooks_path, &text);
    }
    #[cfg(not(windows))]
    {
        let (script_path, hooks_path, config_path) = codex_paths(&app)?;
        if let Some(dir) = script_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&script_path, HOOK_SCRIPT).map_err(|e| e.to_string())?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
        let script_str = script_path.to_str().ok_or("script path is not valid UTF-8")?;

        // Ensure Codex's hooks feature is on, without clobbering the user's config.
        let existing_toml = match std::fs::read_to_string(&config_path) {
            Ok(t) => t,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(err) => return Err(err.to_string()),
        };
        if let Some(dir) = config_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        write_atomic(&config_path, &ensure_hooks_feature(&existing_toml)?)?;

        let cleaned = remove_hook_settings(read_json(&hooks_path)?, script_str, CODEX_EVENTS);
        let merged = merge_hook_settings(cleaned, script_str, CODEX_EVENTS);
        let text = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())? + "\n";
        write_atomic(&hooks_path, &text)
    }
}

/// Remove our entries from `hooks_path`, skipping the rewrite entirely when
/// nothing changed. `raw_script_path` need not be pre-normalized: it is
/// normalized internally (see `normalize`) before matching, mirroring
/// `claude_status_hook`'s `cleanup_settings`. Without this, `remove_hook_settings`
/// only normalizes the *stored* side, so a raw backslash needle (as
/// `script_path.to_str()` yields on Windows) never matches, and the delegated
/// cleanup silently removes zero entries — PR #176 review Fix 1. Only rewrites
/// when an entry was actually removed, so a hooks.json with nothing of ours in
/// it (the common case on every launch) is left untouched — PR #176 review
/// Fix 3. A missing file is a no-op.
fn cleanup_hooks_json(hooks_path: &PathBuf, raw_script_path: &str) -> Result<(), String> {
    if !hooks_path.exists() {
        return Ok(());
    }
    let script_path = normalize(raw_script_path);
    let existing = read_json(hooks_path)?;
    let cleaned = remove_hook_settings(existing.clone(), &script_path, CODEX_EVENTS);
    // On Windows our entry is the native shim, not the `.sh` path; strip it by
    // its stable marker too (the exe path may have moved since install).
    #[cfg(windows)]
    let cleaned = remove_hook_settings(cleaned, SHIM_MARKER, CODEX_EVENTS);
    if cleaned != existing {
        let text = serde_json::to_string_pretty(&cleaned).map_err(|e| e.to_string())? + "\n";
        write_atomic(hooks_path, &text)?;
    }
    Ok(())
}

/// Also called (via
/// `crate::modules::codex_status_hook::codex_status_hook_uninstall`) from
/// `lib.rs`'s `.setup()` on Windows, independent of the user's
/// `claudeStatusTracking` setting (see #155 follow-up, Fix 2).
#[tauri::command]
pub fn codex_status_hook_uninstall(app: AppHandle) -> Result<(), String> {
    let (script_path, hooks_path, _config_path) = codex_paths(&app)?;
    let script_str = script_path.to_str().ok_or("script path is not valid UTF-8")?;
    // Leave `[features] hooks = true` in config.toml: it is shared infra other
    // tools (e.g. CodeIsland) rely on. Only remove our hooks.json entries + script.
    cleanup_hooks_json(&hooks_path, script_str)?;
    let _ = std::fs::remove_file(&script_path);
    if let Some(dir) = script_path.parent() {
        let _ = std::fs::remove_dir(dir);
    }
    Ok(())
}

/// Ensure `[features] hooks = true` in the given config.toml text, preserving all
/// other keys, tables, and comments. Returns the updated text. A blank input
/// yields a document containing just the features table.
pub fn ensure_hooks_feature(existing_toml: &str) -> Result<String, String> {
    let mut doc = existing_toml
        .parse::<DocumentMut>()
        .map_err(|e| format!("config.toml is not valid TOML: {e}"))?;
    // Ensure [features] exists as an explicit table header, not a dotted key
    if !doc.contains_table("features") {
        doc["features"] = Item::Table(Table::new());
    }
    doc["features"]["hooks"] = value(true);
    Ok(doc.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use crate::modules::claude_status_hook::{merge_hook_settings, remove_hook_settings};

    #[test]
    fn codex_merge_keeps_codeisland_entries_and_adds_ours() {
        let existing = json!({
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": "/Users/u/.codeisland/codeisland-bridge --source codex" }] }
                ]
            }
        });
        let merged = merge_hook_settings(existing, "/c/status-hook.sh", CODEX_EVENTS);
        let pre = merged["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| e["hooks"][0]["command"]
            .as_str()
            .is_some_and(|c| c.contains("codeisland-bridge"))));
        assert!(pre.iter().any(|e| e["hooks"][0]["command"] == "/c/status-hook.sh active"));
        // No Notification event for Codex.
        assert!(merged["hooks"].get("Notification").is_none());
        let cleaned = remove_hook_settings(merged, "/c/status-hook.sh", CODEX_EVENTS);
        let pre = cleaned["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| e["hooks"][0]["command"].as_str().is_some_and(|c| c.contains("codeisland-bridge"))));
        assert!(!pre.iter().any(|e| e["hooks"][0]["command"].as_str().is_some_and(|c| c.contains("status-hook.sh"))));
    }

    #[test]
    fn ensure_hooks_feature_preserves_existing_keys_and_comments() {
        let input = "model = \"gpt-5.5\"\n# keep me\n[features]\nmulti_agent = true\n";
        let out = ensure_hooks_feature(input).unwrap();
        assert!(out.contains("model = \"gpt-5.5\""));
        assert!(out.contains("# keep me"));
        assert!(out.contains("multi_agent = true"));
        assert!(out.contains("hooks = true"));
    }

    #[test]
    fn ensure_hooks_feature_is_noop_when_already_true() {
        let input = "[features]\nhooks = true\n";
        let out = ensure_hooks_feature(input).unwrap();
        assert_eq!(out.matches("hooks = true").count(), 1);
    }

    #[test]
    fn ensure_hooks_feature_creates_features_table_when_absent() {
        let out = ensure_hooks_feature("model = \"x\"\n").unwrap();
        assert!(out.contains("[features]"));
        assert!(out.contains("hooks = true"));
    }

    #[test]
    fn ensure_hooks_feature_flips_false_to_true_keeping_other_keys() {
        let input = "[features]\nmulti_agent = true\nhooks = false\n";
        let out = ensure_hooks_feature(input).unwrap();
        assert!(out.contains("hooks = true"));
        assert!(!out.contains("hooks = false"));
        assert!(out.contains("multi_agent = true"));
    }

    #[test]
    fn ensure_hooks_feature_preserves_a_comment_inside_features() {
        let input = "[features]\n# flag for multi-agent\nmulti_agent = true\n";
        let out = ensure_hooks_feature(input).unwrap();
        assert!(out.contains("# flag for multi-agent"));
        assert!(out.contains("multi_agent = true"));
        assert!(out.contains("hooks = true"));
    }

    fn temp_dir_for(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tt-codex-hook-cleanup-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // --- cleanup_hooks_json: PR #176 review findings --------------------------

    #[test]
    fn cleanup_hooks_json_removes_stale_backslash_entries_given_a_raw_backslash_path() {
        // Fix 1: on Windows, `script_path.to_str()` yields backslashes. The
        // stored command may also be backslash (an old Windows build wrote it
        // raw, no normalize). remove_hook_settings only normalizes the stored
        // side, so the caller's needle must be normalized too, or nothing
        // matches and the delegated cleanup silently removes zero entries.
        let dir = temp_dir_for("backslash-needle");
        let hooks_path = dir.join("hooks.json");
        let stale = json!({
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": r"C:\Users\me\.codex\tempoterm\status-hook.sh active" }] }
                ]
            }
        });
        std::fs::write(&hooks_path, serde_json::to_string_pretty(&stale).unwrap()).unwrap();

        // Raw, un-normalized script path, exactly as `script_path.to_str()`
        // would hand it to us on Windows.
        let raw_script_path = r"C:\Users\me\.codex\tempoterm\status-hook.sh";
        cleanup_hooks_json(&hooks_path, raw_script_path).unwrap();

        let after: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&hooks_path).unwrap()).unwrap();
        assert!(after.get("hooks").is_none(), "stale backslash entry should have been removed");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cleanup_hooks_json_skips_rewrite_when_nothing_to_remove() {
        // Fix 3: a hooks.json with no tempo-term entries must come out
        // byte-identical, including key order (no preserve_order feature, so
        // any unconditional rewrite re-sorts keys alphabetically).
        let dir = temp_dir_for("noop");
        let hooks_path = dir.join("hooks.json");
        let original = "{\n  \"zeta\": 1,\n  \"alpha\": 2\n}\n";
        std::fs::write(&hooks_path, original).unwrap();

        cleanup_hooks_json(&hooks_path, "/home/me/.codex/tempoterm/status-hook.sh").unwrap();

        let after = std::fs::read_to_string(&hooks_path).unwrap();
        assert_eq!(after, original, "file with nothing to remove must be left byte-identical");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cleanup_hooks_json_rewrites_when_an_entry_is_actually_removed() {
        let dir = temp_dir_for("changed");
        let hooks_path = dir.join("hooks.json");
        let merged = merge_hook_settings(json!({}), "/c/status-hook.sh", CODEX_EVENTS);
        std::fs::write(&hooks_path, serde_json::to_string_pretty(&merged).unwrap()).unwrap();

        cleanup_hooks_json(&hooks_path, "/c/status-hook.sh").unwrap();

        let after: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&hooks_path).unwrap()).unwrap();
        assert!(after.get("hooks").is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
