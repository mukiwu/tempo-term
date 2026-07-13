//! First-run setup wizard backend: detects the CLI tools a Vibe Coding user
//! needs (node, git, gh, claude, codex, antigravity) plus the platform package
//! managers, and installs the missing ones with live output streamed to the
//! wizard. The tool registry is data-driven so adding or tweaking a tool is a
//! one-line change; version comparison is a pure function for easy testing.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use wait_timeout::ChildExt;

/// Ceiling on a single `<tool> --version` probe. A hung binary (a stalled
/// mount, an interactive prompt) must not freeze detection — bound the wait and
/// treat a timeout as "not installed". Detection runs ~6 probes on first launch.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// A single tool the wizard knows how to detect and install. The install
/// commands are the raw shell strings run per platform; an empty string means
/// "no automated install, guide the user to the official page instead".
struct ToolSpec {
    /// Stable id shared with the frontend registry.
    id: &'static str,
    /// The binary to probe with `<bin> --version`.
    bin: &'static str,
    /// Minimum acceptable major.minor, or None when any version is fine.
    min_version: Option<&'static str>,
    /// Install command on macOS (run via `sh -c`).
    mac_install: &'static str,
    /// Install command on Windows (run via `cmd /C`).
    windows_install: &'static str,
}

/// The tool registry. Keep in sync with the frontend `setup/lib/registry.ts`.
const TOOLS: &[ToolSpec] = &[
    ToolSpec {
        id: "node",
        bin: "node",
        min_version: Some("18"),
        mac_install: "brew install node",
        windows_install: "winget install -e --id OpenJS.NodeJS --accept-package-agreements --accept-source-agreements",
    },
    ToolSpec {
        id: "git",
        bin: "git",
        min_version: Some("2.30"),
        mac_install: "brew install git",
        windows_install: "winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements",
    },
    ToolSpec {
        id: "gh",
        bin: "gh",
        min_version: Some("2.0"),
        mac_install: "brew install gh",
        windows_install: "winget install -e --id GitHub.cli --accept-package-agreements --accept-source-agreements",
    },
    ToolSpec {
        id: "claude",
        bin: "claude",
        min_version: None,
        mac_install: "npm install -g @anthropic-ai/claude-code",
        windows_install: "npm install -g @anthropic-ai/claude-code",
    },
    ToolSpec {
        id: "codex",
        bin: "codex",
        min_version: None,
        mac_install: "npm install -g @openai/codex",
        windows_install: "npm install -g @openai/codex",
    },
    ToolSpec {
        // Official installer scripts from https://antigravity.google/cli.
        // macOS/Linux uses the bash installer; Windows uses the CMD installer.
        // Both install the binary as `agy` (~/.local/bin/agy on Unix,
        // %LOCALAPPDATA%\agy\bin\agy.exe on Windows), never `antigravity`.
        id: "antigravity",
        bin: "agy",
        min_version: None,
        mac_install: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
        // Write the installer to an absolute TEMP path (the GUI process CWD is
        // often read-only) and clean up unconditionally with `&` — `&&` would
        // skip `del` whenever curl fails, leaving the file behind.
        windows_install: "curl -fsSL https://antigravity.google/cli/install.cmd -o \"%TEMP%\\ag_install.cmd\" & call \"%TEMP%\\ag_install.cmd\" & del \"%TEMP%\\ag_install.cmd\"",
    },
];

/// Detection result for one tool, returned to the wizard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: String,
    pub installed: bool,
    pub version: Option<String>,
    pub meets_min: bool,
    /// Whether this tool has an automated install command on the current OS.
    pub installable: bool,
}

/// The whole detection payload: per-tool status plus package-manager presence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResult {
    pub tools: Vec<ToolStatus>,
    /// Homebrew present (macOS package manager).
    pub brew: bool,
    /// winget present (Windows package manager).
    pub winget: bool,
}

/// Pull the first dotted numeric token out of a `--version` line, e.g.
/// "git version 2.50.1 (Apple Git-155)" -> "2.50.1", "v22.14.0" -> "22.14.0".
pub fn parse_version(output: &str) -> Option<String> {
    let bytes = output.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                i += 1;
            }
            // Trim a trailing dot so "1." never slips through.
            let token = output[start..i].trim_end_matches('.');
            if token.chars().any(|c| c.is_ascii_digit()) {
                return Some(token.to_string());
            }
        } else {
            i += 1;
        }
    }
    None
}

/// Compare a detected version against a minimum, component by component. A
/// missing component counts as 0 (so "2" satisfies min "2.0"). Non-numeric
/// input fails closed (returns false).
pub fn meets_min(version: &str, min: &str) -> bool {
    let parse = |s: &str| -> Option<Vec<u64>> {
        s.split('.').map(|p| p.parse::<u64>().ok()).collect()
    };
    let (Some(have), Some(need)) = (parse(version), parse(min)) else {
        return false;
    };
    let len = have.len().max(need.len());
    for idx in 0..len {
        let h = have.get(idx).copied().unwrap_or(0);
        let n = need.get(idx).copied().unwrap_or(0);
        if h != n {
            return h > n;
        }
    }
    true
}

/// Candidate file names for an executable. Windows binaries carry an extension
/// (`node.exe`) and npm ships `.cmd`/`.bat` shims — a bare `claude` file never
/// exists on disk there (#89) — so probe every common extension; elsewhere the
/// stem itself is the only candidate. Pure for testing.
fn exe_names(stem: &str, windows: bool) -> Vec<String> {
    if windows {
        [".exe", ".cmd", ".bat"]
            .iter()
            .map(|ext| format!("{stem}{ext}"))
            .collect()
    } else {
        vec![stem.to_string()]
    }
}

/// Directories to search for a CLI, in priority order: PATH first, then the
/// common install locations a GUI launch's minimal PATH omits (Homebrew/npm on
/// macOS; Program Files, chocolatey, scoop and the npm prefix on Windows). Pure
/// so both platform arms are unit-tested on the macOS CI runner.
fn search_dirs(
    path_env: Option<&str>,
    home: Option<&str>,
    appdata: Option<&str>,
    localappdata: Option<&str>,
    windows: bool,
) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = match path_env {
        Some(path) => std::env::split_paths(path).collect(),
        None => Vec::new(),
    };
    if windows {
        for extra in [
            r"C:\Program Files\nodejs",
            r"C:\Program Files\Git\cmd",
            r"C:\Program Files\GitHub CLI",
            r"C:\Program Files (x86)\GitHub CLI",
            r"C:\ProgramData\chocolatey\bin",
        ] {
            dirs.push(PathBuf::from(extra));
        }
        // npm installs global shims (claude.cmd, codex.cmd) under %APPDATA%\npm.
        if let Some(appdata) = appdata {
            dirs.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(localappdata) = localappdata {
            // The antigravity installer writes agy.exe here and never touches
            // PATH, so detection must probe it directly.
            dirs.push(PathBuf::from(localappdata).join("agy").join("bin"));
        }
        if let Some(home) = home {
            dirs.push(PathBuf::from(home).join("scoop").join("shims"));
        }
    } else {
        for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
            dirs.push(PathBuf::from(extra));
        }
        if let Some(home) = home {
            // npm --prefix bins, antigravity's agy, and pipx-style bins.
            dirs.push(PathBuf::from(home).join(".local").join("bin"));
        }
    }
    dirs
}

/// Bin directories for Node version managers whose global CLIs live outside a
/// GUI launch's minimal PATH: nvm (one bin per installed node version), volta,
/// and asdf. `nvm_versions` are the version dir names read from
/// `~/.nvm/versions/node` (e.g. "v22.14.0"). Pure so the path shape and the
/// per-version expansion are unit-tested; the directory read that supplies
/// `nvm_versions` lives in `read_nvm_node_versions`. Unix-focused — these
/// managers' Windows layouts differ and npm-prefix/winget already cover the
/// Windows CLIs.
fn node_version_manager_dirs(home: Option<&str>, nvm_versions: &[String]) -> Vec<PathBuf> {
    let Some(home) = home else {
        return Vec::new();
    };
    let home = PathBuf::from(home);
    let mut dirs = vec![
        home.join(".volta").join("bin"),
        home.join(".asdf").join("shims"),
    ];
    let nvm_node = home.join(".nvm").join("versions").join("node");
    for version in nvm_versions {
        dirs.push(nvm_node.join(version).join("bin"));
    }
    dirs
}

/// Version directory names under `~/.nvm/versions/node` (e.g. "v22.14.0"), or
/// empty when nvm isn't installed. Touches the filesystem, so it's kept out of
/// the pure path helpers and its output is fed into `node_version_manager_dirs`.
fn read_nvm_node_versions(home: Option<&str>) -> Vec<String> {
    let Some(home) = home else {
        return Vec::new();
    };
    let node_root = PathBuf::from(home).join(".nvm").join("versions").join("node");
    let Ok(entries) = std::fs::read_dir(&node_root) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect()
}

/// First existing `name` across `dirs`, or None. Split out of `find_tool` so the
/// PATH-independent resolution — a tool present only under an nvm bin, exactly
/// the GUI-launch case this fixes — is unit-tested without mutating process env.
fn resolve_in_dirs(names: &[String], dirs: &[PathBuf]) -> Option<PathBuf> {
    for dir in dirs {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Absolute path to `stem`'s executable, or None when it isn't installed.
/// Resolving to an absolute path (never spawning a bare name) both finds the
/// Windows `.exe`/`.cmd` forms and avoids the `CreateProcess` CWD-search hijack,
/// where a planted same-named binary in a writable working dir would run instead.
fn find_tool(stem: &str) -> Option<PathBuf> {
    let path_env = std::env::var("PATH").ok();
    let home = std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok());
    let appdata = std::env::var("APPDATA").ok();
    let localappdata = std::env::var("LOCALAPPDATA").ok();
    let windows = cfg!(windows);
    let names = exe_names(stem, windows);
    let mut dirs = search_dirs(
        path_env.as_deref(),
        home.as_deref(),
        appdata.as_deref(),
        localappdata.as_deref(),
        windows,
    );
    // A GUI launch's PATH omits nvm/volta/asdf, so global CLIs installed on a
    // version-managed node (claude/codex via `npm i -g`) are invisible to the
    // PATH+Homebrew search above. Append those bins so they're found too.
    if !windows {
        let nvm_versions = read_nvm_node_versions(home.as_deref());
        dirs.extend(node_version_manager_dirs(home.as_deref(), &nvm_versions));
    }
    resolve_in_dirs(&names, &dirs)
}

/// Build a `Command` with the console suppressed on Windows. A release build has
/// no console of its own (windows_subsystem = "windows"), so an un-flagged spawn
/// allocates a fresh console that flashes a window — detection alone spawns one
/// probe per tool. A no-op on Unix and on debug builds. See git::run_git / pr.
fn tool_command(exe: &std::path::Path) -> Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut command = Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Resolve and run `<tool> --version`, returning the parsed version or None if
/// the tool is absent, errors, or outruns PROBE_TIMEOUT (killed so a hung binary
/// never lingers). Reads output only after the process exits — `--version` is a
/// few bytes, well under the pipe buffer, so this cannot deadlock.
fn probe_version(stem: &str) -> Option<String> {
    let exe = find_tool(stem)?;
    let mut child = tool_command(&exe)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let output = match child.wait_timeout(PROBE_TIMEOUT) {
        Ok(Some(_)) => child.wait_with_output().ok()?,
        Ok(None) | Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    };
    if !output.status.success() && output.stdout.is_empty() {
        return None;
    }
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    if text.trim().is_empty() {
        text = String::from_utf8_lossy(&output.stderr).into_owned();
    }
    parse_version(&text)
}

/// The install command string for `spec` on the current OS ("" when none).
fn install_command(spec: &ToolSpec) -> &'static str {
    if cfg!(target_os = "windows") {
        spec.windows_install
    } else {
        spec.mac_install
    }
}

/// Detect all tools and the package managers. Runs the blocking probes on a
/// worker thread so the GUI thread never stalls (same reasoning as sysmon).
#[tauri::command]
pub async fn detect_tools() -> Result<DetectResult, String> {
    tauri::async_runtime::spawn_blocking(detect_tools_blocking)
        .await
        .map_err(|e| e.to_string())
}

fn detect_tools_blocking() -> DetectResult {
    let tools = TOOLS
        .iter()
        .map(|spec| {
            let version = probe_version(spec.bin);
            let installed = version.is_some();
            let meets_min = match (&version, spec.min_version) {
                (Some(v), Some(min)) => meets_min(v, min),
                (Some(_), None) => true,
                (None, _) => false,
            };
            ToolStatus {
                id: spec.id.to_string(),
                installed,
                version,
                meets_min,
                installable: !install_command(spec).is_empty(),
            }
        })
        .collect();

    DetectResult {
        tools,
        // Pure filesystem resolution — no subprocess, so no console flash.
        brew: find_tool("brew").is_some(),
        winget: find_tool("winget").is_some(),
    }
}

/// Install one tool by id, streaming combined stdout/stderr to `on_output`
/// line by line. Returns the process exit code (0 = success). stderr is merged
/// into stdout via the shell so a single reader captures everything in order.
#[tauri::command]
pub async fn install_tool(id: String, on_output: Channel<String>) -> Result<i32, String> {
    let spec = TOOLS
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("unknown tool: {id}"))?;
    let cmd = install_command(spec);
    if cmd.is_empty() {
        return Err(format!("no automated install for {id}"));
    }
    let cmd = cmd.to_string();
    tauri::async_runtime::spawn_blocking(move || run_install(&cmd, &on_output))
        .await
        .map_err(|e| e.to_string())?
}

/// Run one install command, streaming its output over `on_output`. The shell
/// merges stderr into stdout (`2>&1`) so a single reader captures everything in
/// order; the child's own stderr pipe is therefore closed (`Stdio::null()`).
///
/// Note: the install cannot be cancelled from the UI — closing the wizard leaves
/// the spawned process (npm/brew/winget) running to completion in the background.
fn run_install(cmd: &str, on_output: &Channel<String>) -> Result<i32, String> {
    // Run from a writable directory: the GUI process CWD is often read-only
    // (install dir / System32), which breaks installers that write to CWD (e.g.
    // antigravity's downloaded .cmd). CREATE_NO_WINDOW keeps a release build from
    // flashing a console for the shell it spawns.
    let temp = std::env::temp_dir();
    let mut builder = if cfg!(target_os = "windows") {
        let mut c = tool_command(std::path::Path::new("cmd"));
        c.arg("/C").arg(format!("{cmd} 2>&1"));
        c
    } else {
        let mut c = tool_command(std::path::Path::new("sh"));
        c.arg("-c").arg(format!("{cmd} 2>&1"));
        c
    };
    let mut child = builder
        .current_dir(temp)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to start install: {e}"))?;

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    let _ = on_output.send(text);
                }
                Err(_) => break,
            }
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    Ok(status.code().unwrap_or(-1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_version_formats() {
        assert_eq!(parse_version("v22.14.0").as_deref(), Some("22.14.0"));
        assert_eq!(
            parse_version("git version 2.50.1 (Apple Git-155)").as_deref(),
            Some("2.50.1")
        );
        assert_eq!(
            parse_version("gh version 2.86.0 (2026-01-21)").as_deref(),
            Some("2.86.0")
        );
        assert_eq!(parse_version("2.1.195 (Claude Code)").as_deref(), Some("2.1.195"));
        assert_eq!(parse_version("codex-cli 0.137.0").as_deref(), Some("0.137.0"));
        assert_eq!(parse_version("no numbers here"), None);
    }

    #[test]
    fn version_comparison() {
        assert!(meets_min("22.14.0", "18"));
        assert!(meets_min("18.0.0", "18"));
        assert!(!meets_min("16.20.0", "18"));
        assert!(meets_min("2.50.1", "2.30"));
        assert!(!meets_min("2.29.0", "2.30"));
        assert!(meets_min("2", "2.0"));
        assert!(meets_min("2.0", "2"));
        assert!(!meets_min("garbage", "2.0"));
    }

    #[test]
    fn exe_names_appends_windows_extensions_only_on_windows() {
        // #89: npm ships claude.cmd, so probing a bare `claude` never matches on
        // Windows — the .cmd/.exe/.bat forms must be tried.
        assert_eq!(exe_names("claude", false), vec!["claude".to_string()]);
        let win = exe_names("claude", true);
        assert!(win.contains(&"claude.exe".to_string()));
        assert!(win.contains(&"claude.cmd".to_string()));
        assert!(win.contains(&"claude.bat".to_string()));
        assert!(!win.contains(&"claude".to_string()));
    }

    #[test]
    fn search_dirs_prepends_path_then_platform_locations() {
        // NB: std::env::split_paths uses the *host* separator, so a Windows-style
        // PATH can't be split correctly on the macOS test runner — assert only
        // the platform extras for the Windows arm, and PATH order on the Unix arm.
        let home = r"C:\Users\me";
        let appdata = r"C:\Users\me\AppData\Roaming";
        let localappdata = r"C:\Users\me\AppData\Local";
        let win = search_dirs(None, Some(home), Some(appdata), Some(localappdata), true);
        // Static install dirs are literals; joined dirs are built the same way so
        // the assertion is separator-agnostic (join uses `/` on the macOS runner).
        assert!(win.contains(&PathBuf::from(r"C:\Program Files\nodejs")));
        // npm global shims live under %APPDATA%\npm.
        assert!(win.contains(&PathBuf::from(appdata).join("npm")));
        // The antigravity installer drops agy.exe under %LOCALAPPDATA%\agy\bin.
        assert!(win.contains(&PathBuf::from(localappdata).join("agy").join("bin")));
        assert!(win.contains(&PathBuf::from(home).join("scoop").join("shims")));

        let unix = search_dirs(Some("/usr/bin"), Some("/home/me"), None, None, false);
        assert_eq!(unix.first(), Some(&PathBuf::from("/usr/bin")));
        assert!(unix.contains(&PathBuf::from("/opt/homebrew/bin")));
        // The antigravity installer targets ~/.local/bin (binary name: agy).
        assert!(unix.contains(&PathBuf::from("/home/me/.local/bin")));
    }

    #[test]
    fn search_dirs_works_without_a_path_or_home() {
        // A GUI launch can hand us no PATH and no HOME; resolution must still
        // return the platform install dirs rather than panic on None.
        let unix = search_dirs(None, None, None, None, false);
        assert!(unix.contains(&PathBuf::from("/usr/local/bin")));
        let win = search_dirs(None, None, None, None, true);
        assert!(win.contains(&PathBuf::from(r"C:\ProgramData\chocolatey\bin")));
    }

    #[test]
    fn node_version_manager_dirs_covers_nvm_volta_asdf() {
        // A GUI launch's PATH omits nvm/volta/asdf (they're wired up in the
        // interactive shell's rc files), so global CLIs installed under them —
        // claude/codex via `npm i -g` on an nvm node — go undetected (#unknown).
        // Each nvm node version has its own global bin, so every installed
        // version dir must be searched.
        let versions = vec!["v22.14.0".to_string(), "v20.11.0".to_string()];
        let dirs = node_version_manager_dirs(Some("/home/me"), &versions);
        assert!(dirs.contains(&PathBuf::from("/home/me/.volta/bin")));
        assert!(dirs.contains(&PathBuf::from("/home/me/.asdf/shims")));
        assert!(dirs.contains(&PathBuf::from("/home/me/.nvm/versions/node/v22.14.0/bin")));
        assert!(dirs.contains(&PathBuf::from("/home/me/.nvm/versions/node/v20.11.0/bin")));
    }

    #[test]
    fn node_version_manager_dirs_empty_without_home() {
        // A bare GUI launch can hand us no HOME; must return empty, not panic.
        assert!(node_version_manager_dirs(None, &["v22.14.0".to_string()]).is_empty());
    }

    #[test]
    fn read_nvm_node_versions_lists_installed_version_dirs() {
        // A controlled ~/.nvm/versions/node tree: the reader returns each
        // version directory name and ignores stray files.
        let base = std::env::temp_dir().join("tempo_setup_nvm_read_test");
        let _ = std::fs::remove_dir_all(&base);
        let node_root = base.join(".nvm").join("versions").join("node");
        std::fs::create_dir_all(node_root.join("v22.14.0").join("bin")).unwrap();
        std::fs::create_dir_all(node_root.join("v18.20.0").join("bin")).unwrap();
        std::fs::write(node_root.join("alias"), b"default").unwrap();

        let versions = read_nvm_node_versions(base.to_str());
        assert!(versions.contains(&"v22.14.0".to_string()));
        assert!(versions.contains(&"v18.20.0".to_string()));
        // A plain file (nvm's `alias`) is not a version dir.
        assert!(!versions.contains(&"alias".to_string()));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn read_nvm_node_versions_empty_when_absent() {
        // No nvm install (or no HOME): empty, never an error.
        let missing = std::env::temp_dir().join("tempo_setup_nvm_absent_test_xyz");
        let _ = std::fs::remove_dir_all(&missing);
        assert!(read_nvm_node_versions(missing.to_str()).is_empty());
        assert!(read_nvm_node_versions(None).is_empty());
    }

    #[test]
    fn resolves_a_tool_present_only_under_an_nvm_bin() {
        // The exact GUI-launch bug: a CLI installed via `npm i -g` on an
        // nvm-managed node lives only under ~/.nvm/versions/node/<ver>/bin and
        // never on the app's PATH. End-to-end, detection must still resolve it
        // from the version-manager dirs alone.
        let base = std::env::temp_dir().join("tempo_setup_e2e_nvm");
        let _ = std::fs::remove_dir_all(&base);
        let bin = base
            .join(".nvm")
            .join("versions")
            .join("node")
            .join("v22.22.2")
            .join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("claude"), b"#!/bin/sh\n").unwrap();

        // No PATH involved — only the nvm dirs discovered from HOME.
        let versions = read_nvm_node_versions(base.to_str());
        let dirs = node_version_manager_dirs(base.to_str(), &versions);
        let found = resolve_in_dirs(&["claude".to_string()], &dirs);

        assert!(found.is_some(), "claude under an nvm bin must be found");
        assert!(found.unwrap().ends_with("v22.22.2/bin/claude"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    #[ignore = "env-dependent: run manually on a machine with an nvm-installed claude"]
    fn real_env_finds_nvm_installed_claude() {
        // Proof on the real machine: using ONLY the version-manager dirs derived
        // from HOME — never PATH — resolve the actual nvm-installed claude. This
        // is the release/GUI scenario (PATH lacks nvm). Run with:
        //   cargo test -p tempo-term real_env_finds_nvm_installed_claude -- --ignored --nocapture
        let home = std::env::var("HOME").ok();
        let versions = read_nvm_node_versions(home.as_deref());
        let dirs = node_version_manager_dirs(home.as_deref(), &versions);
        let found = resolve_in_dirs(&["claude".to_string()], &dirs);
        println!("HOME nvm node versions: {versions:?}");
        println!("claude resolved from nvm dirs (no PATH): {found:?}");
        assert!(found.is_some(), "expected to find the nvm-installed claude");
    }
}
