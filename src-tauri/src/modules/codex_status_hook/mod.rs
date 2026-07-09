//! Installs tempo-term's status hook into Codex's config so Codex sessions
//! report live state as OSC, mirroring the Claude installer. Reuses the shared
//! pure merge over hooks.json and ensures Codex's hooks feature flag is on.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use toml_edit::{DocumentMut, Item, Table, value};

use crate::modules::claude_status_hook::remove_hook_settings;
// Only the non-Windows install path merges our entries and writes the script;
// on Windows install is cleanup-only (#155), so these would be unused there.
#[cfg(not(windows))]
use crate::modules::claude_status_hook::{merge_hook_settings, HOOK_SCRIPT};

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

/// Mirror of `claude_status_hook_install`. On Windows this is a cleanup-only
/// no-op: the OSC→PTY status mechanism has no Windows backend, and a bare
/// forward-slash `.sh` hook command pops the Windows "Open With" picker on every
/// event (#155). Since install runs on every launch, we strip any entries an
/// older build wrote so affected users recover automatically.
#[tauri::command]
pub fn codex_status_hook_install(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        return codex_status_hook_uninstall(app);
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

#[tauri::command]
pub fn codex_status_hook_uninstall(app: AppHandle) -> Result<(), String> {
    let (script_path, hooks_path, _config_path) = codex_paths(&app)?;
    let script_str = script_path.to_str().ok_or("script path is not valid UTF-8")?;
    // Leave `[features] hooks = true` in config.toml: it is shared infra other
    // tools (e.g. CodeIsland) rely on. Only remove our hooks.json entries + script.
    if hooks_path.exists() {
        let cleaned = remove_hook_settings(read_json(&hooks_path)?, script_str, CODEX_EVENTS);
        let text = serde_json::to_string_pretty(&cleaned).map_err(|e| e.to_string())? + "\n";
        write_atomic(&hooks_path, &text)?;
    }
    let _ = std::fs::remove_file(&script_path);
    if let Some(dir) = script_path.parent() {
        let _ = std::fs::remove_dir(dir);
    }
    Ok(())
}

/// Ensure `[features] hooks = true` in the given config.toml text, preserving all
/// other keys, tables, and comments. Returns the updated text. A blank input
/// yields a document containing just the features table. Unused on Windows,
/// where install is cleanup-only and never enables the feature (#155).
#[cfg_attr(windows, allow(dead_code))]
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
}
