//! Shell resolution and terminal environment setup.
//!
//! Kept free of side effects so the decision logic can be unit tested without
//! spawning a real shell.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The prepared wrapper `ZDOTDIR` whose `.zshrc` sources the user's real config
/// then the bundled zsh-autosuggestions plugin. Set once at app startup.
static SUGGEST_ZDOTDIR: OnceLock<Option<PathBuf>> = OnceLock::new();

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

    // `$_TEMPO_UZ` carries the user's real ZDOTDIR (defaulting to $HOME) so their
    // own config still loads. Left unescaped on purpose — it is a shell snippet,
    // not a path.
    let user = r#"${_TEMPO_UZ:-$HOME}"#;
    let wrapper = dir.to_string_lossy();
    let plugin = plugin_path.to_string_lossy();
    for (name, contents) in wrapper_files(user, &wrapper, &plugin) {
        std::fs::write(dir.join(name), contents)?;
    }
    Ok(dir)
}

/// Escape a real filesystem path for safe interpolation inside a zsh
/// double-quoted string, so a path containing `"`, `$`, a backtick or a
/// backslash cannot close the quote, expand a variable, or run a command.
fn zsh_dq_escape(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        if matches!(c, '"' | '\\' | '$' | '`') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// The wrapper startup files as `(filename, contents)` pairs. Pure so the
/// generated shell can be asserted in tests.
///
/// Each file restores `ZDOTDIR` to the user's real dir *before* sourcing their
/// config, so anything reading `$ZDOTDIR` (e.g. `source $ZDOTDIR/aliases`)
/// resolves correctly. Only an **interactive** shell is then steered back
/// through the wrapper so its `.zshrc` loads the plugin; a non-interactive zsh
/// (a script, `zsh -c`) is left on the user's dir with our marker dropped, so
/// nested shells inherit a clean environment rather than the wrapper's.
///
/// The `.zshrc` also rescues `HISTFILE`: macOS's `/etc/zshrc` runs *before* it
/// and computes `HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history` while `ZDOTDIR` is
/// still the wrapper, so history would land in the wrapper dir — empty on first
/// use and never shared with the user's other terminals. We can't intercept the
/// system file, so the wrapper `.zshrc` redirects a wrapper-dir `HISTFILE` back
/// to the user's real dir, before sourcing their config so an explicit user
/// `HISTFILE` still wins.
fn wrapper_files(user: &str, wrapper: &str, plugin: &str) -> Vec<(&'static str, String)> {
    let wrapper = zsh_dq_escape(wrapper);
    let plugin = zsh_dq_escape(plugin);
    vec![
        (
            ".zshenv",
            format!(
                "ZDOTDIR=\"{user}\"\n\
                 [[ -f \"$ZDOTDIR/.zshenv\" ]] && source \"$ZDOTDIR/.zshenv\"\n\
                 if [[ -o interactive ]]; then\n\
                 ZDOTDIR=\"{wrapper}\"\n\
                 else\n\
                 unset _TEMPO_UZ\n\
                 fi\n"
            ),
        ),
        (
            ".zprofile",
            format!(
                "ZDOTDIR=\"{user}\"\n\
                 [[ -f \"$ZDOTDIR/.zprofile\" ]] && source \"$ZDOTDIR/.zprofile\"\n\
                 [[ -o interactive ]] && ZDOTDIR=\"{wrapper}\"\n"
            ),
        ),
        (
            ".zshrc",
            format!(
                "ZDOTDIR=\"{user}\"\n\
                 unset _TEMPO_UZ\n\
                 [[ \"$HISTFILE\" == \"{wrapper}\"/* ]] && HISTFILE=\"$ZDOTDIR/${{HISTFILE:t}}\"\n\
                 [[ -f \"$ZDOTDIR/.zshrc\" ]] && source \"$ZDOTDIR/.zshrc\"\n\
                 [[ -f \"{plugin}\" ]] && source \"{plugin}\"\n"
            ),
        ),
    ]
}

/// The `(key, value)` environment pairs to inject so a freshly spawned `shell`
/// loads zsh-autosuggestions. `enabled` is the user's "suggest previous
/// commands" setting, read per spawn so a session always reflects the current
/// setting. Empty unless enabled, the shell is zsh, and the wrapper was prepared
/// — so non-zsh shells are untouched.
pub fn autosuggest_env(shell: &str, enabled: bool) -> Vec<(String, String)> {
    if !enabled || !is_zsh(shell) {
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

/// Pick the shell program. A non-empty `shell_override` (the user's custom
/// shell-path setting) wins, then a non-empty `$SHELL`, otherwise a sensible
/// per-platform default.
pub fn resolve_shell_from(shell_override: Option<String>, shell_env: Option<String>) -> String {
    let non_empty = |v: Option<String>| v.filter(|s| !s.trim().is_empty());
    non_empty(shell_override)
        .or_else(|| non_empty(shell_env))
        .unwrap_or_else(default_shell)
}

/// Resolve the shell from the live environment, honouring an optional user
/// override (the custom shell-path setting, passed per spawn).
pub fn resolve_shell_with(shell_override: Option<String>) -> String {
    resolve_shell_from(shell_override, std::env::var("SHELL").ok())
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

/// PowerShell shell-integration snippet that reports the shell's cwd via an
/// OSC 7 escape before every prompt. Windows' cwd source for the
/// explorer-follows-terminal feature: macOS reads a process's cwd with `lsof`
/// and Linux with `/proc`, but Windows has no OS-level equivalent, so the shell
/// announces its own directory instead (the frontend parses it — see
/// src/modules/terminal/lib/osc7.ts).
///
/// Wraps — never replaces — the user's `prompt`. Profiles run before the
/// injected command, so a custom prompt (oh-my-posh, posh-git, Starship) is
/// already in place and keeps rendering exactly as before. Non-filesystem
/// locations (registry drives etc.) report nothing. `System.Uri` renders the
/// path as a percent-encoded `file://` URI, which keeps spaces and non-ASCII
/// (e.g. CJK folder names) unambiguous. The env marker makes the wrap
/// idempotent if the snippet is ever sourced twice.
const POWERSHELL_OSC7_SNIPPET: &str = r#"if ($env:TEMPOTERM_OSC7 -ne '1') {
  $env:TEMPOTERM_OSC7 = '1'
  $global:__tempoTermPrompt = $function:prompt
  function global:prompt {
    $text = if ($global:__tempoTermPrompt) { & $global:__tempoTermPrompt } else { "PS $($PWD.Path)> " }
    if ($PWD.Provider.Name -eq 'FileSystem') {
      try {
        $uri = ([System.Uri]$PWD.ProviderPath).AbsoluteUri
        $esc = [char]27
        [Console]::Write("$esc]7;$uri$esc\")
      } catch {}
    }
    $text
  }
}"#;

/// The last path component, split on both separators so a Windows path still
/// resolves when this code is unit-tested on Unix, lowercased for matching.
fn shell_file_name(shell: &str) -> String {
    shell
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(shell)
        .to_ascii_lowercase()
}

/// True for Windows PowerShell (`powershell.exe`) and PowerShell 7+ (`pwsh`).
fn is_powershell(shell: &str) -> bool {
    matches!(
        shell_file_name(shell).trim_end_matches(".exe"),
        "powershell" | "pwsh"
    )
}

/// True for `cmd.exe`, the `COMSPEC` default.
fn is_cmd(shell: &str) -> bool {
    shell_file_name(shell).trim_end_matches(".exe") == "cmd"
}

/// PowerShell's `-EncodedCommand` payload: base64 of the UTF-16LE script bytes.
fn encoded_command(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    STANDARD.encode(bytes)
}

/// Extra launch arguments that wire up cwd reporting on Windows. PowerShell
/// gets the OSC 7 prompt wrapper via `-EncodedCommand` — never a script file,
/// so it works under any ExecutionPolicy (a dot-sourced `.ps1` would be blocked
/// by the client default, `Restricted`) and needs no quoting through the
/// Windows command line. Other shells get nothing.
pub fn windows_integration_args(shell: &str) -> Vec<String> {
    if !is_powershell(shell) {
        return Vec::new();
    }
    vec![
        "-NoExit".to_string(),
        "-EncodedCommand".to_string(),
        encoded_command(POWERSHELL_OSC7_SNIPPET),
    ]
}

/// Extra environment that wires up cwd reporting on Windows. cmd.exe has no
/// prompt function to wrap, but its `PROMPT` string expands `$e` to ESC and
/// `$p` to the current directory, so prefixing the user's prompt (default
/// `$P$G`, i.e. `C:\dir>`) with an OSC 7 report does the same job. The path
/// arrives raw — unencoded spaces and backslashes — which the frontend parser
/// tolerates. Other shells get nothing.
pub fn windows_integration_env(
    shell: &str,
    current_prompt: Option<String>,
) -> Vec<(String, String)> {
    if !is_cmd(shell) {
        return Vec::new();
    }
    let user_prompt = current_prompt
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| "$P$G".to_string());
    vec![(
        "PROMPT".to_string(),
        format!("$e]7;file://localhost/$P$e\\{user_prompt}"),
    )]
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
            resolve_shell_from(None, Some("/usr/bin/fish".to_string())),
            "/usr/bin/fish"
        );
    }

    #[test]
    fn falls_back_to_default_when_shell_env_missing_or_blank() {
        let from_none = resolve_shell_from(None, None);
        let from_blank = resolve_shell_from(None, Some("   ".to_string()));
        assert_eq!(from_none, from_blank);
        assert!(from_none.starts_with('/') || from_none.ends_with(".exe"));
    }

    #[test]
    fn custom_override_wins_over_shell_env() {
        assert_eq!(
            resolve_shell_from(
                Some("/opt/homebrew/bin/pwsh".to_string()),
                Some("/bin/zsh".to_string()),
            ),
            "/opt/homebrew/bin/pwsh"
        );
    }

    #[test]
    fn blank_override_falls_through_to_shell_env() {
        assert_eq!(
            resolve_shell_from(Some("   ".to_string()), Some("/bin/zsh".to_string())),
            "/bin/zsh"
        );
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
    fn autosuggest_env_is_empty_when_disabled_or_non_zsh() {
        // A non-zsh shell is untouched even when the setting is on, and zsh is
        // untouched when the setting is off.
        assert!(autosuggest_env("/bin/bash", true).is_empty());
        assert!(autosuggest_env("/bin/zsh", false).is_empty());
    }

    #[test]
    fn wrapper_files_escape_paths_in_double_quoted_strings() {
        // A path with shell metacharacters must be backslash-escaped so it can't
        // close the quote or trigger expansion; the user snippet is left raw.
        let files = wrapper_files(
            r#"${_TEMPO_UZ:-$HOME}"#,
            r#"/tmp/a"b$c`d\e/zsh"#,
            r#"/p/plug".zsh"#,
        );
        let by = |name: &str| files.iter().find(|(n, _)| *n == name).unwrap().1.clone();

        let zshenv = by(".zshenv");
        assert!(
            zshenv.contains(r#"ZDOTDIR="/tmp/a\"b\$c\`d\\e/zsh""#),
            "wrapper path should be escaped, got: {zshenv}"
        );
        // The user snippet stays unescaped — it is intentional shell.
        assert!(zshenv.contains(r#"ZDOTDIR="${_TEMPO_UZ:-$HOME}""#));

        let zshrc = by(".zshrc");
        assert!(
            zshrc.contains(r#"source "/p/plug\".zsh""#),
            "plugin path should be escaped, got: {zshrc}"
        );
    }

    #[test]
    fn wrapper_zshenv_only_re_enters_wrapper_for_interactive_shells() {
        // A non-interactive zsh (script, `zsh -c`) must stay on the user's dir
        // and drop the marker so nested shells get a clean environment.
        let files = wrapper_files(r#"${_TEMPO_UZ:-$HOME}"#, "/w/zsh", "/p/plugin.zsh");
        let zshenv = files.iter().find(|(n, _)| *n == ".zshenv").unwrap().1.clone();
        assert!(zshenv.contains("if [[ -o interactive ]]; then"));
        assert!(zshenv.contains("unset _TEMPO_UZ"));
        // .zprofile likewise only steers interactive shells back to the wrapper.
        let zprofile = files.iter().find(|(n, _)| *n == ".zprofile").unwrap().1.clone();
        assert!(zprofile.contains(r#"[[ -o interactive ]] && ZDOTDIR="/w/zsh""#));
    }

    #[test]
    fn wrapper_zshrc_restores_histfile_polluted_by_wrapper_zdotdir() {
        // macOS's /etc/zshrc runs *before* our wrapper .zshrc and computes
        // `HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history` while ZDOTDIR is still the
        // wrapper, so history lands in the wrapper dir — empty on first use and
        // never shared with other terminals. The .zshrc must redirect a
        // wrapper-dir HISTFILE back to the user's real ZDOTDIR, and do so before
        // sourcing the user's config so anyone who sets their own HISTFILE wins.
        let files = wrapper_files(r#"${_TEMPO_UZ:-$HOME}"#, "/w/zsh", "/p/plugin.zsh");
        let zshrc = files.iter().find(|(n, _)| *n == ".zshrc").unwrap().1.clone();
        assert!(
            zshrc.contains(r#"[[ "$HISTFILE" == "/w/zsh"/* ]] && HISTFILE="$ZDOTDIR/${HISTFILE:t}""#),
            "zshrc should rewrite a wrapper HISTFILE back to the user dir, got: {zshrc}"
        );
        let fix_idx = zshrc
            .find("HISTFILE=\"$ZDOTDIR/")
            .expect("zshrc should rewrite HISTFILE");
        let source_idx = zshrc
            .find(r#"source "$ZDOTDIR/.zshrc""#)
            .expect("zshrc should source the user's .zshrc");
        assert!(
            fix_idx < source_idx,
            "HISTFILE fix must precede sourcing the user's .zshrc, got: {zshrc}"
        );
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

    /// Decode an `-EncodedCommand` payload (base64 → UTF-16LE) back to text.
    fn decode_encoded_command(b64: &str) -> String {
        let bytes = STANDARD.decode(b64).expect("valid base64");
        let units: Vec<u16> = bytes
            .chunks(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16(&units).expect("valid UTF-16LE")
    }

    #[test]
    fn powershell_gets_the_osc7_prompt_wrapper_as_an_encoded_command() {
        for shell in [
            "powershell.exe",
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
            "pwsh.exe",
            "pwsh",
            "/opt/homebrew/bin/pwsh",
        ] {
            let args = windows_integration_args(shell);
            assert_eq!(args.len(), 3, "{shell}: expected 3 args, got {args:?}");
            assert_eq!(args[0], "-NoExit");
            assert_eq!(args[1], "-EncodedCommand");
            // The payload must round-trip to the snippet: an OSC 7 emitter that
            // wraps (not replaces) the user's prompt and skips non-filesystem
            // providers like registry drives.
            let script = decode_encoded_command(&args[2]);
            assert_eq!(script, POWERSHELL_OSC7_SNIPPET);
            assert!(script.contains("]7;"));
            assert!(script.contains("$function:prompt"));
            assert!(script.contains("FileSystem"));
        }
    }

    #[test]
    fn non_powershell_shells_get_no_integration_args() {
        assert!(windows_integration_args(r"C:\Windows\System32\cmd.exe").is_empty());
        assert!(windows_integration_args("/bin/zsh").is_empty());
        assert!(windows_integration_args("/usr/bin/nu").is_empty());
    }

    #[test]
    fn cmd_gets_an_osc7_prompt_prefix_keeping_the_default_prompt() {
        for shell in ["cmd.exe", r"C:\Windows\System32\cmd.exe", "cmd"] {
            let env = windows_integration_env(shell, None);
            assert_eq!(
                env,
                vec![(
                    "PROMPT".to_string(),
                    r"$e]7;file://localhost/$P$e\$P$G".to_string()
                )],
                "{shell}"
            );
        }
        // A blank inherited PROMPT falls back to the default too.
        let env = windows_integration_env("cmd.exe", Some("   ".to_string()));
        assert_eq!(env[0].1, r"$e]7;file://localhost/$P$e\$P$G");
    }

    #[test]
    fn cmd_prompt_prefix_preserves_a_custom_prompt() {
        let env = windows_integration_env("cmd.exe", Some("$D $P$G".to_string()));
        assert_eq!(env[0].1, r"$e]7;file://localhost/$P$e\$D $P$G");
    }

    #[test]
    fn non_cmd_shells_get_no_integration_env() {
        assert!(windows_integration_env("powershell.exe", None).is_empty());
        assert!(windows_integration_env("/bin/zsh", None).is_empty());
    }
}
