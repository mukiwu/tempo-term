//! Per-app language preference for macOS native UI.
//!
//! The bundle declares its supported localizations in Info.plist, but AppKit
//! picks which one to use from the user's language list — the system one, or
//! the per-app `AppleLanguages` default when set. Writing that default when
//! the user switches the in-app language lets the native surfaces we keep
//! (the editor/notes context menu) follow the app's language after a
//! relaunch. Other platforms have no equivalent concept, so the command is a
//! no-op there.

/// Locales the app actually ships (mirror of SUPPORTED_LANGUAGES in
/// src/i18n/config.ts — keep in sync when adding a locale). The webview is
/// the caller, so reject anything else: the impact ceiling is only junk in
/// the app's own preference, but there is no reason to accept it.
const ALLOWED_LANGUAGES: [&str; 2] = ["en", "zh-Hant"];

fn validate_languages(languages: &[String]) -> Result<(), String> {
    if languages.is_empty() || languages.len() > ALLOWED_LANGUAGES.len() {
        return Err("invalid languages length".to_string());
    }
    if !languages
        .iter()
        .all(|l| ALLOWED_LANGUAGES.contains(&l.as_str()))
    {
        return Err("unsupported language".to_string());
    }
    Ok(())
}

/// Arguments for `defaults write <bundle-id> AppleLanguages -array <langs…>`.
/// Split out so the shape is unit-testable without touching the real
/// preferences store.
#[cfg(any(target_os = "macos", test))]
fn defaults_write_args(bundle_id: &str, languages: &[String]) -> Vec<String> {
    let mut args = vec![
        "write".to_string(),
        bundle_id.to_string(),
        "AppleLanguages".to_string(),
        "-array".to_string(),
    ];
    args.extend(languages.iter().cloned());
    args
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn set_app_languages(
    app: tauri::AppHandle,
    languages: Vec<String>,
) -> Result<(), String> {
    validate_languages(&languages)?;
    let bundle_id = app.config().identifier.clone();
    let args = defaults_write_args(&bundle_id, &languages);
    let output = std::process::Command::new("defaults")
        .args(&args)
        .output()
        .map_err(|e| format!("failed to run defaults: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "defaults write failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn set_app_languages(languages: Vec<String>) -> Result<(), String> {
    // No per-app language preference concept off macOS; still validate so the
    // command behaves uniformly across platforms.
    validate_languages(&languages)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_defaults_write_invocation() {
        let args = defaults_write_args(
            "com.tempoterm.desktop",
            &["zh-Hant".to_string()],
        );
        assert_eq!(
            args,
            vec!["write", "com.tempoterm.desktop", "AppleLanguages", "-array", "zh-Hant"]
        );
    }

    #[test]
    fn rejects_languages_outside_the_shipped_set() {
        assert!(validate_languages(&["zh-Hant".to_string()]).is_ok());
        assert!(validate_languages(&["en".to_string(), "zh-Hant".to_string()]).is_ok());
        assert!(validate_languages(&[]).is_err());
        assert!(validate_languages(&["fr".to_string()]).is_err());
        assert!(validate_languages(&["-currentHost".to_string()]).is_err());
        assert!(validate_languages(&vec!["en".to_string(); 3]).is_err());
    }

    #[test]
    fn keeps_multiple_languages_in_order() {
        let args = defaults_write_args(
            "com.tempoterm.desktop",
            &["zh-Hant".to_string(), "en".to_string()],
        );
        assert_eq!(args[4..], ["zh-Hant".to_string(), "en".to_string()]);
    }
}
