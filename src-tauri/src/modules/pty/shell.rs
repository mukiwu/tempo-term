//! Shell resolution and terminal environment setup.
//!
//! Kept free of side effects so the decision logic can be unit tested without
//! spawning a real shell.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

/// Whether to enable fish-like command autosuggestions for new zsh shells. The
/// frontend mirrors the user setting into this via `pty_set_suggestions`.
static SUGGESTIONS_ENABLED: AtomicBool = AtomicBool::new(false);

/// The prepared wrapper `ZDOTDIR` whose `.zshrc` sources the user's real config
/// then the bundled zsh-autosuggestions plugin. Set once at app startup.
static SUGGEST_ZDOTDIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Mirror the user's "suggest previous commands" setting; read when spawning.
pub fn set_suggestions_enabled(enabled: bool) {
    SUGGESTIONS_ENABLED.store(enabled, Ordering::Relaxed);
}

fn suggestions_enabled() -> bool {
    SUGGESTIONS_ENABLED.load(Ordering::Relaxed)
}

/// Build the wrapper `ZDOTDIR` under `app_data_dir` whose startup files load the
/// user's real zsh config and then `plugin_path`. Stores the result for later
/// spawns. Idempotent and best-effort: a write failure simply disables the
/// feature rather than blocking the shell. Call once during app setup.
pub fn init_autosuggest_zdotdir(app_data_dir: &Path, plugin_path: &Path) {
    SUGGEST_ZDOTDIR.get_or_init(|| build_wrapper_zdotdir(app_data_dir, plugin_path).ok());
}

fn build_wrapper_zdotdir(app_data_dir: &Path, plugin_path: &Path) -> std::io::Result<PathBuf> {
    let dir = app_data_dir.join("zsh");
    std::fs::create_dir_all(&dir)?;

    // Each file falls back to the user's real ZDOTDIR ($_TEMPO_UZ, defaulting to
    // $HOME) so the user's own config still loads. .zshrc then restores ZDOTDIR
    // so the interactive session and .zlogin behave as if we were never here.
    let user = r#"${_TEMPO_UZ:-$HOME}"#;
    let wrapper = dir.to_string_lossy();
    // Each startup file restores ZDOTDIR to the user's real dir *before* sourcing
    // their config, so anything that reads $ZDOTDIR (e.g. `source $ZDOTDIR/aliases`)
    // resolves correctly. .zshenv/.zprofile then point ZDOTDIR back at the wrapper
    // so zsh keeps loading the remaining wrapper files; .zshrc leaves it on the
    // user's dir so the interactive session and .zlogin behave normally.
    std::fs::write(
        dir.join(".zshenv"),
        format!(
            "ZDOTDIR=\"{user}\"\n\
             [[ -f \"$ZDOTDIR/.zshenv\" ]] && source \"$ZDOTDIR/.zshenv\"\n\
             ZDOTDIR=\"{wrapper}\"\n"
        ),
    )?;
    std::fs::write(
        dir.join(".zprofile"),
        format!(
            "ZDOTDIR=\"{user}\"\n\
             [[ -f \"$ZDOTDIR/.zprofile\" ]] && source \"$ZDOTDIR/.zprofile\"\n\
             ZDOTDIR=\"{wrapper}\"\n"
        ),
    )?;
    let plugin = plugin_path.to_string_lossy();
    std::fs::write(
        dir.join(".zshrc"),
        format!(
            "ZDOTDIR=\"{user}\"\n\
             unset _TEMPO_UZ\n\
             [[ -f \"$ZDOTDIR/.zshrc\" ]] && source \"$ZDOTDIR/.zshrc\"\n\
             [[ -f \"{plugin}\" ]] && source \"{plugin}\"\n"
        ),
    )?;
    Ok(dir)
}

/// The `(key, value)` environment pairs to inject so a freshly spawned `shell`
/// loads zsh-autosuggestions. Empty unless the feature is enabled, the shell is
/// zsh, and the wrapper was prepared — so non-zsh shells are untouched.
pub fn autosuggest_env(shell: &str) -> Vec<(String, String)> {
    if !suggestions_enabled() || !is_zsh(shell) {
        return Vec::new();
    }
    let Some(Some(zdotdir)) = SUGGEST_ZDOTDIR.get() else {
        return Vec::new();
    };
    // Remember the user's real ZDOTDIR (default $HOME) before we override it, so
    // the wrapper can still source their config.
    let user_zdotdir =
        std::env::var("ZDOTDIR").unwrap_or_else(|_| std::env::var("HOME").unwrap_or_default());
    vec![
        ("_TEMPO_UZ".to_string(), user_zdotdir),
        ("ZDOTDIR".to_string(), zdotdir.to_string_lossy().into_owned()),
    ]
}

/// True when the shell path is some flavour of zsh (the only shell the bundled
/// autosuggestions plugin supports).
fn is_zsh(shell: &str) -> bool {
    Path::new(shell)
        .file_name()
        .and_then(|s| s.to_str())
        .map(|name| name == "zsh" || name == "-zsh")
        .unwrap_or(false)
}

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

/// A UTF-8 locale that is reliably present on the target platform. We only need
/// a UTF-8 codeset for `LC_CTYPE`; the territory is incidental.
#[cfg(target_os = "macos")]
fn utf8_locale() -> &'static str {
    // Always shipped on macOS.
    "en_US.UTF-8"
}

#[cfg(not(target_os = "macos"))]
fn utf8_locale() -> &'static str {
    // Language-neutral and present on modern glibc/musl.
    "C.UTF-8"
}

/// True when a locale value carries a UTF-8 codeset (e.g. `zh_TW.UTF-8`).
fn is_utf8_locale(value: &str) -> bool {
    value.to_lowercase().replace('-', "").contains("utf8")
}

/// Build the base environment a terminal session should run with.
///
/// `lc_all`, `lc_ctype` and `lang` are whatever those variables currently hold.
/// The effective character encoding follows the POSIX precedence
/// `LC_ALL` > `LC_CTYPE` > `LANG`. When the winning value is not a UTF-8 locale
/// (missing, `C`, `POSIX`, or any non-UTF-8 codeset) we force a UTF-8 locale so
/// multi-byte input/output (including CJK) is not mangled. A GUI launch from
/// Finder inherits no shell locale at all, which is exactly this case.
pub fn terminal_env(
    lc_all: Option<String>,
    lc_ctype: Option<String>,
    lang: Option<String>,
) -> Vec<(String, String)> {
    let mut env = vec![
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
        ("TERM_PROGRAM".to_string(), "TempoTerm".to_string()),
        ("TEMPOTERM".to_string(), "1".to_string()),
    ];

    let non_empty = |v: Option<String>| v.filter(|s| !s.trim().is_empty());
    let lc_all = non_empty(lc_all);
    let effective = lc_all
        .clone()
        .or_else(|| non_empty(lc_ctype))
        .or_else(|| non_empty(lang));

    let already_utf8 = effective.as_deref().map(is_utf8_locale).unwrap_or(false);
    if !already_utf8 {
        // `LC_ALL` outranks `LC_CTYPE`, so when it is the (non-UTF-8) value in
        // effect we must override it directly; otherwise `LC_CTYPE` is enough.
        let key = if lc_all.is_some() { "LC_ALL" } else { "LC_CTYPE" };
        env.push((key.to_string(), utf8_locale().to_string()));
    }

    env
}

/// Login-shell flag so the shell sources its profile (`~/.zprofile`, and on
/// macOS `/etc/zprofile`'s `path_helper`) and inherits the full login PATH —
/// Homebrew's `/opt/homebrew/bin` in particular. A GUI-launched terminal
/// otherwise runs a non-login shell that misses those paths, so tools like `gh`
/// and `pngpaste` are not found.
pub fn login_args(shell: &str) -> Vec<String> {
    let name = shell.rsplit('/').next().unwrap_or(shell);
    match name {
        "zsh" | "bash" | "fish" => vec!["-l".to_string()],
        _ => Vec::new(),
    }
}

/// Keep a start directory only when it is a real, existing directory. A restored
/// session may point at a folder that has since been deleted; spawning there
/// would fail, so fall back (the caller drops to the default) instead.
pub fn usable_cwd(cwd: Option<String>) -> Option<String> {
    cwd.filter(|d| !d.trim().is_empty())
        .filter(|d| std::path::Path::new(d).is_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launches_known_shells_as_login_shells() {
        assert_eq!(login_args("/bin/zsh"), vec!["-l".to_string()]);
        assert_eq!(login_args("/bin/bash"), vec!["-l".to_string()]);
        assert_eq!(login_args("/usr/local/bin/fish"), vec!["-l".to_string()]);
    }

    #[test]
    fn leaves_unknown_shells_without_a_login_flag() {
        assert!(login_args("powershell.exe").is_empty());
        assert!(login_args("/usr/bin/nu").is_empty());
    }

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
        let env = terminal_env(None, None, Some("en_US.UTF-8".to_string()));
        assert!(env.contains(&("TERM".to_string(), "xterm-256color".to_string())));
        assert!(env.contains(&("COLORTERM".to_string(), "truecolor".to_string())));
    }

    #[test]
    fn detects_zsh_only() {
        assert!(is_zsh("/bin/zsh"));
        assert!(is_zsh("/opt/homebrew/bin/zsh"));
        assert!(is_zsh("-zsh"));
        assert!(!is_zsh("/bin/bash"));
        assert!(!is_zsh("/usr/local/bin/fish"));
    }

    #[test]
    fn autosuggest_env_is_empty_for_non_zsh() {
        // Even with the feature toggled on, a non-zsh shell gets no env changes.
        set_suggestions_enabled(true);
        assert!(autosuggest_env("/bin/bash").is_empty());
        set_suggestions_enabled(false);
    }

    fn has_utf8(env: &[(String, String)], key: &str) -> bool {
        env.iter()
            .any(|(k, v)| k == key && v.to_lowercase().replace('-', "").contains("utf8"))
    }

    #[test]
    fn forces_utf8_ctype_when_lang_is_c() {
        let env = terminal_env(None, None, Some("C".to_string()));
        assert!(has_utf8(&env, "LC_CTYPE"));
    }

    #[test]
    fn forces_utf8_ctype_when_no_locale_is_set() {
        // A Finder/Dock launch inherits no shell locale at all.
        let env = terminal_env(None, None, None);
        assert!(has_utf8(&env, "LC_CTYPE"));
    }

    #[test]
    fn keeps_existing_utf8_lang_untouched() {
        let env = terminal_env(None, None, Some("zh_TW.UTF-8".to_string()));
        assert!(!env.iter().any(|(k, _)| k.starts_with("LC_") || k == "LANG"));
    }

    #[test]
    fn respects_lc_ctype_precedence_over_lang() {
        // LC_CTYPE outranks LANG, so a UTF-8 LC_CTYPE means we leave it alone.
        let env = terminal_env(None, Some("en_US.UTF-8".to_string()), Some("C".to_string()));
        assert!(!env.iter().any(|(k, _)| k.starts_with("LC_") || k == "LANG"));
    }

    #[test]
    fn overrides_lc_all_when_it_forces_a_non_utf8_locale() {
        // LC_ALL outranks LC_CTYPE, so patching LC_CTYPE alone would not win.
        let env = terminal_env(Some("C".to_string()), None, Some("zh_TW.UTF-8".to_string()));
        assert!(has_utf8(&env, "LC_ALL"));
    }

    #[test]
    fn usable_cwd_keeps_existing_dirs_and_drops_the_rest() {
        assert_eq!(usable_cwd(Some("/".to_string())), Some("/".to_string()));
        assert_eq!(usable_cwd(Some("/no/such/dir/zzz_tempoterm".to_string())), None);
        assert_eq!(usable_cwd(Some("   ".to_string())), None);
        assert_eq!(usable_cwd(None), None);
    }
}
