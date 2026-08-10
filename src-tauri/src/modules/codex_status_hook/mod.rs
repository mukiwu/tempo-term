//! Installs tempo-term's status hook into Codex's config so Codex sessions
//! report live state over the loopback status IPC, mirroring the Claude
//! installer. Reuses the shared pure merge over hooks.json and ensures
//! Codex's hooks feature flag is on.

use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::{AppHandle, Manager};
use toml_edit::{DocumentMut, Item, Table, value};

use crate::modules::claude_status_hook::{
    merge_hook_settings, normalize, our_command, remove_hook_settings, shim_prefix,
    shim_prefix_native, LEGACY_SCRIPT_MARKER, SHIM_MARKER,
};

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

/// Ensure `[features] hooks = true` in the config.toml at `config_path`,
/// writing only when the text actually changes (toml_edit preserves
/// formatting, so already-correct input round-trips byte-identical).
fn ensure_hooks_feature_at(config_path: &Path) -> Result<(), String> {
    let existing = match std::fs::read_to_string(config_path) {
        Ok(t) => t,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(err) if err.kind() == std::io::ErrorKind::InvalidData => {
            // The classic Windows trap: a PowerShell 5.1 redirect rewrites the
            // file as UTF-16, which read_to_string cannot decode. Name the fix
            // instead of surfacing a bare "stream did not contain valid UTF-8".
            return Err(format!(
                "{} is not UTF-8 (PowerShell redirects often write UTF-16); re-save it as UTF-8",
                config_path.display()
            ));
        }
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

/// File-level install: reconcile `hooks_path` to hold exactly our current shim
/// entries, writing only when the result differs from what's on disk (see
/// `claude_status_hook::install_into` for why). Split for testability.
fn install_into(
    hooks_path: &Path,
    prefix: &str,
    windows_prefix: Option<&str>,
) -> Result<(), String> {
    let existing = read_json(hooks_path)?;
    let cleaned = remove_hook_settings(existing.clone(), LEGACY_SCRIPT_MARKER, CODEX_EVENTS);
    let cleaned = remove_hook_settings(cleaned, SHIM_MARKER, CODEX_EVENTS);
    let merged = merge_hook_settings(cleaned, prefix, CODEX_EVENTS);
    let merged = match windows_prefix {
        Some(windows_prefix) => add_windows_command(merged, windows_prefix),
        None => merged,
    };
    if merged == existing {
        return Ok(());
    }
    let text = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())? + "\n";
    write_atomic(hooks_path, &text)
}

/// File-level install order matters: reconcile hooks.json BEFORE touching
/// config.toml. A config.toml problem (UTF-16 from a PowerShell redirect,
/// invalid TOML) used to early-return first, so stale agentless hook entries
/// were never upgraded — they keep reporting without an agent field and the
/// UI holds the previous agent's icon (issue #279). The config error still
/// surfaces after the upgrade.
fn install_at(
    hooks_path: &Path,
    config_path: &Path,
    prefix: &str,
    windows_prefix: Option<&str>,
) -> Result<(), String> {
    install_into(hooks_path, prefix, windows_prefix)?;
    ensure_hooks_feature_at(config_path)
}

/// Give every one of our entries a `commandWindows` alongside its `command`.
///
/// Codex runs a hook's command through `cmd.exe /C` on Windows (its
/// `build_command` defaults to that shell), while `command` carries the
/// forward-slash path `normalize` produces for the benefit of runners that go
/// through bash. `commandWindows` overrides `command` on Windows only, so the
/// two runners can each get the path form they can actually execute. Codex
/// deserializes it with `#[serde(default)]`, so a build that predates the field
/// ignores it rather than failing to parse.
///
/// Only entries carrying [`SHIM_MARKER`] are touched — a user's own hooks are
/// left exactly as they are. Takes the prefix rather than a whole command so
/// each event's state argument is appended the same way `merge_hook_settings`
/// does it, via the shared `our_command`.
fn add_windows_command(mut merged: Value, windows_prefix: &str) -> Value {
    let Some(hooks) = merged.get_mut("hooks").and_then(Value::as_object_mut) else {
        return merged;
    };
    for (event, state) in CODEX_EVENTS {
        let Some(entries) = hooks.get_mut(*event).and_then(Value::as_array_mut) else {
            continue;
        };
        for entry in entries.iter_mut() {
            let Some(handlers) = entry.get_mut("hooks").and_then(Value::as_array_mut) else {
                continue;
            };
            for handler in handlers.iter_mut() {
                let ours = handler
                    .get("command")
                    .and_then(Value::as_str)
                    .is_some_and(|command| command.contains(SHIM_MARKER));
                if !ours {
                    continue;
                }
                if let Some(object) = handler.as_object_mut() {
                    object.insert(
                        "commandWindows".to_string(),
                        Value::String(our_command(windows_prefix, state)),
                    );
                }
            }
        }
    }
    merged
}

/// Mirror of `claude_status_hook_install`: registers the native shim
/// (`"<exe>" --status-hook codex`) that reports over loopback (see `status_ipc`),
/// migrating away any legacy `.sh` a pre-#181 build wrote. Also enables
/// Codex's `hooks` feature so it runs the hook.
/// Steady state is a no-op: files are only written when their content would change.
#[tauri::command]
pub fn codex_status_hook_install(app: AppHandle) -> Result<(), String> {
    let (script_path, hooks_path, config_path) = codex_paths(&app)?;
    let _ = std::fs::remove_file(&script_path);
    let prefix = shim_prefix("codex")?;
    // Windows only: Codex executes hook commands through `cmd.exe /C`, which
    // does not reliably run the forward-slash path `shim_prefix` produces for
    // bash-based runners. Off Windows the two prefixes would be identical, so
    // the field is left out entirely rather than written as a no-op (issue
    // #279).
    let windows_prefix = if cfg!(windows) {
        Some(shim_prefix_native("codex")?)
    } else {
        None
    };
    install_at(&hooks_path, &config_path, &prefix, windows_prefix.as_deref())
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
    // Our entry may be the native shim rather than the legacy `.sh` path;
    // strip it by its stable marker too (the exe path may have moved since
    // install).
    let cleaned = remove_hook_settings(cleaned, SHIM_MARKER, CODEX_EVENTS);
    if cleaned != existing {
        let text = serde_json::to_string_pretty(&cleaned).map_err(|e| e.to_string())? + "\n";
        write_atomic(hooks_path, &text)?;
    }
    Ok(())
}

/// Mirror of `claude_status_hook_uninstall` for Codex: remove our hooks.json
/// entries and delete the legacy script. Only invoked from the frontend when
/// the user turns status tracking off; the launch-time migration path is
/// `codex_status_hook_cleanup_legacy`. Leaves `[features] hooks = true` in
/// config.toml: it is shared infra other tools (e.g. CodeIsland) rely on.
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

/// Ensure `[features] hooks = true` in the given config.toml text, preserving all
/// other keys, tables, and comments. Returns the updated text. A blank input
/// yields a document containing just the features table. A UTF-8 BOM (typical
/// of files edited with PowerShell) is stripped, not treated as a TOML error;
/// the write-back drops it, which every TOML parser is happy with.
pub fn ensure_hooks_feature(existing_toml: &str) -> Result<String, String> {
    let existing_toml = existing_toml.strip_prefix('\u{feff}').unwrap_or(existing_toml);
    // BOM-less UTF-16 decodes as valid UTF-8 (ASCII chars interleaved with
    // NULs) and would produce a baffling TOML error; name the real problem.
    if existing_toml.contains('\0') {
        return Err(
            "config.toml contains NUL bytes — it is probably UTF-16; re-save it as UTF-8"
                .to_string(),
        );
    }
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

    #[test]
    fn ensure_hooks_feature_tolerates_a_utf8_bom() {
        // PowerShell writes UTF-8 files with a BOM; toml_edit rejects it as
        // invalid TOML, which used to fail the whole install (issue #279).
        let input = "\u{feff}model = \"gpt-5.5\"\n";
        let out = ensure_hooks_feature(input).unwrap();
        assert!(out.contains("model = \"gpt-5.5\""));
        assert!(out.contains("hooks = true"));
        assert!(!out.starts_with('\u{feff}'), "the BOM must not be written back");
    }

    #[test]
    fn install_at_upgrades_hooks_json_even_when_config_toml_is_broken() {
        // Issue #279: a config.toml that cannot be read/parsed (UTF-16 from a
        // PowerShell redirect, invalid TOML) used to early-return BEFORE the
        // hooks.json upgrade, leaving stale agentless entries behind forever —
        // those report without an agent field and the UI keeps showing the
        // previous agent's icon. hooks.json must be reconciled first; the
        // config error still surfaces.
        let dir = temp_dir_for("broken-config");
        let hooks_path = dir.join("hooks.json");
        let config_path = dir.join("config.toml");
        let stale = json!({
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": "/old/tempoterm/status-hook.sh active" }] }
                ]
            }
        });
        std::fs::write(&hooks_path, serde_json::to_string_pretty(&stale).unwrap()).unwrap();
        // UTF-16LE with BOM, exactly what a PowerShell 5.1 redirect writes;
        // the 0xFF 0xFE BOM makes read_to_string fail with InvalidData.
        let mut utf16: Vec<u8> = vec![0xFF, 0xFE];
        utf16.extend("model = \"x\"\n".encode_utf16().flat_map(u16::to_le_bytes));
        std::fs::write(&config_path, utf16).unwrap();

        let err = install_at(
            &hooks_path,
            &config_path,
            "\"/app/tempo-term\" --status-hook codex",
            None,
        )
        .unwrap_err();
        assert!(err.contains("UTF-8"), "unexpected error: {err}");

        let after: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&hooks_path).unwrap()).unwrap();
        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(
            pre.iter().any(|e| e["hooks"][0]["command"]
                .as_str()
                .is_some_and(|c| c.contains("--status-hook codex"))),
            "hooks.json should hold the new shim entry despite the config error"
        );
        assert!(
            !pre.iter().any(|e| e["hooks"][0]["command"]
                .as_str()
                .is_some_and(|c| c.contains("status-hook.sh"))),
            "the stale legacy entry should be gone"
        );

        let _ = std::fs::remove_dir_all(&dir);
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

    const SHIM_PREFIX: &str = r#""C:/Program Files/TempoTerm/tempo-term.exe" --status-hook codex"#;

    #[test]
    fn codex_install_into_skips_rewrite_when_already_correct() {
        let dir = temp_dir_for("install-noop");
        let hooks_path = dir.join("hooks.json");
        let merged = merge_hook_settings(json!({}), SHIM_PREFIX, CODEX_EVENTS);
        let original = serde_json::to_string_pretty(&merged).unwrap() + "\n";
        std::fs::write(&hooks_path, &original).unwrap();

        install_into(&hooks_path, SHIM_PREFIX, None).unwrap();

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

    /// The same executable as SHIM_PREFIX, spelled the way Windows reports it.
    const WINDOWS_SHIM_PREFIX: &str =
        r#""C:\Program Files\TempoTerm\tempo-term.exe" --status-hook codex"#;

    #[test]
    fn windows_command_carries_the_native_path_and_the_events_own_state() {
        // command keeps the forward-slash form for bash-based runners;
        // commandWindows is what Codex actually executes on Windows, where the
        // command goes through cmd.exe (issue #279).
        let merged = merge_hook_settings(json!({}), SHIM_PREFIX, CODEX_EVENTS);
        let with_windows = add_windows_command(merged, WINDOWS_SHIM_PREFIX);

        for (event, state) in CODEX_EVENTS {
            let handler = &with_windows["hooks"][*event][0]["hooks"][0];
            assert_eq!(
                handler["command"],
                json!(format!("{SHIM_PREFIX} {state}")),
                "{event} command"
            );
            assert_eq!(
                handler["commandWindows"],
                json!(format!("{WINDOWS_SHIM_PREFIX} {state}")),
                "{event} commandWindows"
            );
        }
    }

    #[test]
    fn windows_command_is_not_added_to_a_users_own_hook() {
        let existing = json!({
            "hooks": {
                "SessionStart": [
                    { "hooks": [{ "type": "command", "command": "echo mine" }] }
                ]
            }
        });
        let merged = merge_hook_settings(existing, SHIM_PREFIX, CODEX_EVENTS);
        let with_windows = add_windows_command(merged, WINDOWS_SHIM_PREFIX);

        let entries = with_windows["hooks"]["SessionStart"].as_array().unwrap();
        let theirs = entries
            .iter()
            .find(|e| e["hooks"][0]["command"] == json!("echo mine"))
            .expect("the user's own hook must survive");
        assert!(
            theirs["hooks"][0].get("commandWindows").is_none(),
            "only entries carrying the shim marker may gain a commandWindows"
        );
    }

    #[test]
    fn install_writes_the_windows_command_when_one_is_given() {
        let dir = temp_dir_for("windows-command");
        let hooks_path = dir.join("hooks.json");

        install_into(&hooks_path, SHIM_PREFIX, Some(WINDOWS_SHIM_PREFIX)).unwrap();

        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&hooks_path).unwrap()).unwrap();
        assert_eq!(
            written["hooks"]["SessionStart"][0]["hooks"][0]["commandWindows"],
            json!(format!("{WINDOWS_SHIM_PREFIX} idle"))
        );

        // Re-running with the same inputs must still be a no-op, or every
        // launch rewrites the file.
        let before = std::fs::metadata(&hooks_path).unwrap().modified().unwrap();
        install_into(&hooks_path, SHIM_PREFIX, Some(WINDOWS_SHIM_PREFIX)).unwrap();
        let after = std::fs::metadata(&hooks_path).unwrap().modified().unwrap();
        assert_eq!(before, after, "an already-correct hooks.json must not be rewritten");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_upgrades_an_existing_entry_that_has_no_windows_command() {
        // What every current Windows user has on disk: our entries from a
        // build that predates commandWindows. install_into removes and rebuilds
        // our entries, so the upgrade needs no separate migration step.
        let dir = temp_dir_for("windows-command-upgrade");
        let hooks_path = dir.join("hooks.json");
        let old = merge_hook_settings(json!({}), SHIM_PREFIX, CODEX_EVENTS);
        std::fs::write(&hooks_path, serde_json::to_string_pretty(&old).unwrap()).unwrap();

        install_into(&hooks_path, SHIM_PREFIX, Some(WINDOWS_SHIM_PREFIX)).unwrap();

        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&hooks_path).unwrap()).unwrap();
        assert_eq!(
            written["hooks"]["PreToolUse"][0]["hooks"][0]["commandWindows"],
            json!(format!("{WINDOWS_SHIM_PREFIX} active"))
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
