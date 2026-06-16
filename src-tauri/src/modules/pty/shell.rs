//! Shell resolution and terminal environment setup.
//!
//! Kept free of side effects so the decision logic can be unit tested without
//! spawning a real shell.

/// Pick the shell program. A non-empty `$SHELL` wins, otherwise fall back to a
/// sensible per-platform default.
pub fn resolve_shell_from(shell_env: Option<String>) -> String {
    match shell_env {
        Some(s) if !s.trim().is_empty() => s,
        _ => default_shell(),
    }
}

/// Resolve the shell from the live environment.
pub fn resolve_shell() -> String {
    resolve_shell_from(std::env::var("SHELL").ok())
}

#[cfg(not(windows))]
fn default_shell() -> String {
    // macOS defaults to zsh; most Linux distros ship bash. zsh is the safer
    // first guess on the platform we target first.
    "/bin/zsh".to_string()
}

#[cfg(windows)]
fn default_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
}

/// Build the base environment a terminal session should run with.
///
/// `existing_lang` is whatever `$LANG` currently holds. When it is missing or
/// empty we inject a UTF-8 locale so multi-byte output (including CJK) is not
/// mangled by a C/POSIX locale.
pub fn terminal_env(existing_lang: Option<String>) -> Vec<(String, String)> {
    let mut env = vec![
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
        ("TERM_PROGRAM".to_string(), "TempoTerm".to_string()),
        ("TEMPOTERM".to_string(), "1".to_string()),
    ];

    let lang_missing = existing_lang
        .as_deref()
        .map(|l| l.trim().is_empty())
        .unwrap_or(true);
    if lang_missing {
        env.push(("LANG".to_string(), "en_US.UTF-8".to_string()));
    }

    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_shell_env_when_set() {
        assert_eq!(
            resolve_shell_from(Some("/usr/bin/fish".to_string())),
            "/usr/bin/fish"
        );
    }

    #[test]
    fn falls_back_to_default_when_shell_env_missing_or_blank() {
        let from_none = resolve_shell_from(None);
        let from_blank = resolve_shell_from(Some("   ".to_string()));
        assert_eq!(from_none, from_blank);
        assert!(from_none.starts_with('/') || from_none.ends_with(".exe"));
    }

    #[test]
    fn terminal_env_always_sets_term_and_colorterm() {
        let env = terminal_env(Some("en_US.UTF-8".to_string()));
        assert!(env.contains(&("TERM".to_string(), "xterm-256color".to_string())));
        assert!(env.contains(&("COLORTERM".to_string(), "truecolor".to_string())));
    }

    #[test]
    fn terminal_env_injects_utf8_lang_when_missing() {
        let env = terminal_env(None);
        assert!(env
            .iter()
            .any(|(k, v)| k == "LANG" && v.contains("UTF-8")));
    }

    #[test]
    fn terminal_env_keeps_existing_lang() {
        let env = terminal_env(Some("zh_TW.UTF-8".to_string()));
        assert!(!env.iter().any(|(k, _)| k == "LANG"));
    }
}
