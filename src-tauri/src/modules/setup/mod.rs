//! First-run setup wizard backend: detects the CLI tools a Vibe Coding user
//! needs (node, git, gh, claude, codex, antigravity) plus the platform package
//! managers, and installs the missing ones with live output streamed to the
//! wizard. The tool registry is data-driven so adding or tweaking a tool is a
//! one-line change; version comparison is a pure function for easy testing.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
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
        // OpenAI's standalone installer needs neither Node nor npm and writes
        // `codex` to ~/.local/bin, which is one of our probe locations. Piped
        // to bash (not sh) to tolerate bashisms, like the antigravity line.
        mac_install: "curl -fsSL https://chatgpt.com/codex/install.sh | bash",
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

/// fnm's data root: `$FNM_DIR` when set, else the per-OS default —
/// `%APPDATA%\fnm` (Windows), `~/Library/Application Support/fnm` (macOS), or
/// `$XDG_DATA_HOME/fnm` else `~/.local/share/fnm` (other Unix). These mirror
/// fnm's own `dirs::data_dir()`-based default; a GUI launch never inherits the
/// shell's `$FNM_DIR`, so the default is what actually resolves there and must be
/// right (Roaming `%APPDATA%`, not Local `%LOCALAPPDATA%`). Pure: the OS is passed
/// in so every default branch is unit-tested on the macOS runner.
fn fnm_root(
    fnm_dir: Option<&str>,
    home: Option<&str>,
    appdata: Option<&str>,
    xdg_data_home: Option<&str>,
    windows: bool,
    macos: bool,
) -> Option<PathBuf> {
    if let Some(dir) = fnm_dir {
        return Some(PathBuf::from(dir));
    }
    if windows {
        // APPDATA is normally set, but a stripped GUI/service env can drop it;
        // fall back to rebuilding the Roaming path from home (USERPROFILE).
        return appdata
            .map(|a| PathBuf::from(a).join("fnm"))
            .or_else(|| home.map(|h| PathBuf::from(h).join("AppData").join("Roaming").join("fnm")));
    }
    // Only the home-based defaults need `home`; a set XDG_DATA_HOME must still
    // resolve when HOME is absent (a stripped GUI launch can hand us neither).
    if macos {
        home.map(|h| {
            PathBuf::from(h)
                .join("Library")
                .join("Application Support")
                .join("fnm")
        })
    } else if let Some(xdg) = xdg_data_home {
        Some(PathBuf::from(xdg).join("fnm"))
    } else {
        home.map(|h| PathBuf::from(h).join(".local").join("share").join("fnm"))
    }
}

/// Bin directories for an fnm install rooted at `root`: the `default` alias plus
/// every installed node version. fnm keeps each node under
/// `<root>/node-versions/<ver>/installation` and symlinks the active default to
/// `<root>/aliases/default`. On Windows the node executables and `npm i -g` shims
/// sit directly in `installation` (npm's prefix there); on Unix they're in
/// `installation/bin`. Pure so the platform path shape is unit-tested; the
/// version-dir read lives in `read_fnm_node_versions`.
fn fnm_dirs(root: &Path, versions: &[String], windows: bool) -> Vec<PathBuf> {
    let bin = |dir: PathBuf| if windows { dir } else { dir.join("bin") };
    let node_versions = root.join("node-versions");
    let mut dirs = vec![bin(root.join("aliases").join("default"))];
    for version in versions {
        dirs.push(bin(node_versions.join(version).join("installation")));
    }
    dirs
}

/// Version directory names under `<root>/node-versions` (e.g. "v24.17.0"),
/// skipping fnm's `.downloads` staging dir; empty when fnm isn't installed.
/// Touches the filesystem, so it's kept out of the pure path helpers and its
/// output feeds `fnm_dirs`.
fn read_fnm_node_versions(root: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root.join("node-versions")) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        // file_type() is cached from the readdir entry on most platforms, so it
        // avoids the per-entry PathBuf alloc + stat that entry.path().is_dir() costs.
        .filter(|entry| entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.'))
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
fn tool_search_dirs() -> Vec<PathBuf> {
    let path_env = std::env::var("PATH").ok();
    let home = std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok());
    let appdata = std::env::var("APPDATA").ok();
    let localappdata = std::env::var("LOCALAPPDATA").ok();
    let windows = cfg!(windows);
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
    // fnm keeps its node installs (and their `npm i -g` shims) under $FNM_DIR
    // or a per-OS default, reached only through a per-shell PATH a GUI launch
    // never inherits. Unlike nvm/volta/asdf above, this arm runs on Windows too:
    // an fnm node's global shims land in the version's install dir, not
    // %APPDATA%\npm, so the Windows npm-prefix search misses them.
    let fnm_dir = std::env::var("FNM_DIR").ok();
    let xdg_data_home = std::env::var("XDG_DATA_HOME").ok();
    if let Some(root) = fnm_root(
        fnm_dir.as_deref(),
        home.as_deref(),
        appdata.as_deref(),
        xdg_data_home.as_deref(),
        windows,
        cfg!(target_os = "macos"),
    ) {
        let fnm_versions = read_fnm_node_versions(&root);
        dirs.extend(fnm_dirs(&root, &fnm_versions, windows));
    }
    dirs
}

/// Dirs a spawned child may resolve tools from and receive as PATH: the
/// preferred dir (a resolved exe's own directory, so an npm shim's sibling
/// node wins) first, then the candidates, deduped. This is the single
/// chokepoint for the CWD-hijack filter: only absolute dirs pass, because an
/// empty, ".", or any other relative entry (a bare exe name's `Path::parent()`
/// is `Some("")`; an inherited PATH can carry `::`) resolves against the CWD —
/// the planted-binary hijack that resolving to absolute paths exists to
/// prevent. Pure so both filter branches are unit-tested.
fn command_search_dirs(preferred: Option<&Path>, candidates: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(dir) = preferred.filter(|dir| dir.is_absolute()) {
        dirs.push(dir.to_path_buf());
    }
    for dir in candidates {
        if dir.is_absolute() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

/// PATH for a child process launched by the GUI. The app's inherited PATH is
/// often minimal, so a resolved npm shim may still fail at its `env node`
/// shebang unless we also expose the shim's sibling Node binary.
fn command_path(preferred: Option<&Path>) -> std::ffi::OsString {
    std::env::join_paths(command_search_dirs(preferred, tool_search_dirs())).unwrap_or_else(|_| {
        // A candidate dir containing the separator poisons the join. Falling
        // back to the raw inherited PATH would resurrect the empty/relative
        // entries the filter strips, so rebuild from its absolute entries
        // instead — those came from a split on the separator, so they can't
        // poison the re-join.
        let inherited = std::env::var_os("PATH").unwrap_or_default();
        let absolute: Vec<PathBuf> = std::env::split_paths(&inherited)
            .filter(|dir| dir.is_absolute())
            .collect();
        std::env::join_paths(absolute).unwrap_or_default()
    })
}

fn find_tool(stem: &str) -> Option<PathBuf> {
    let windows = cfg!(windows);
    let names = exe_names(stem, windows);
    // Resolution flows through the same absolute-only chokepoint as the child
    // PATH: an inherited-PATH empty entry would otherwise make
    // `"".join(name).is_file()` probe the CWD and hand back a relative exe to
    // spawn — the same planted-binary hijack, entered through the exe argument.
    resolve_in_dirs(&names, &command_search_dirs(None, tool_search_dirs()))
}

/// Build a `Command` with the console suppressed on Windows. A release build has
/// no console of its own (windows_subsystem = "windows"), so an un-flagged spawn
/// allocates a fresh console that flashes a window — detection alone spawns one
/// probe per tool. A no-op on Unix and on debug builds. See git::run_git / pr.
fn tool_command(exe: &std::path::Path) -> Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut command = Command::new(exe);
    command.env("PATH", command_path(exe.parent()));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Run `<exe> --version`, returning the parsed version or None if it errors
/// or outruns PROBE_TIMEOUT (killed so a hung binary never lingers). Takes the
/// already-resolved exe so callers sharing a detection run resolve each tool
/// once. Reads output only after the process exits — `--version` is a few
/// bytes, well under the pipe buffer, so this cannot deadlock.
fn probe_version(exe: &Path) -> Option<String> {
    let mut child = tool_command(exe)
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

/// The (installed, meets_min) verdict for one tool. `version` is the probe
/// result, `resolved` is whether an executable file was found on disk, and
/// `min_version` is the spec's minimum. Encodes the exists-but-unprobeable
/// fallback: a resolved-but-unversioned tool counts as installed — the
/// wizard's job is deciding whether to run the installer, and a present
/// binary must not be reinstalled — but it satisfies meets_min only when the
/// spec has no minimum (fail closed: an unknown version must never be
/// assumed new enough). Pure.
fn tool_verdict(version: Option<&str>, resolved: bool, min_version: Option<&str>) -> (bool, bool) {
    match (version, resolved) {
        (Some(v), _) => (true, min_version.is_none_or(|min| meets_min(v, min))),
        (None, true) => (true, min_version.is_none()),
        (None, false) => (false, false),
    }
}

/// Marks a tool's block inside the login-shell batch probe output, followed by
/// the tool id and a newline; the block body runs to [`TOOL_SENTINEL_END`].
/// Sentinels let the parser ignore whatever rc files print around the blocks.
const TOOL_SENTINEL_START: &str = "__TEMPO_TOOL_START__";
const TOOL_SENTINEL_END: &str = "__TEMPO_TOOL_END__";

/// Ceiling on the whole login-shell batch probe: one shell startup (rc files,
/// lazy nvm hooks) plus every tool's `--version`, so it gets more room than a
/// single PROBE_TIMEOUT; killed on overrun, falling back to the dir scan.
const SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// The shell to spawn for the batch probe: `$SHELL` when set, else the per-OS
/// fallback (`/bin/zsh` on macOS, `/bin/sh` elsewhere). Pure.
fn shell_binary(shell_env: Option<&str>, macos: bool) -> String {
    match shell_env {
        Some(shell) if !shell.is_empty() => shell.to_string(),
        _ => if macos { "/bin/zsh" } else { "/bin/sh" }.to_string(),
    }
}

/// The batch probe script: for each (id, bin), print the start sentinel plus
/// the id, run `<bin> --version` with stderr dropped (an absent tool's
/// command-not-found noise must leave its block empty, not corrupt it), then
/// print the end sentinel. Ids and bins come from the static TOOLS registry
/// only — never user input — so quoting is not a concern. Pure.
fn shell_probe_script(tools: &[(&str, &str)]) -> String {
    tools
        .iter()
        .map(|(id, bin)| {
            // The bin is quoted so a future registry entry containing a space
            // or metacharacter can never silently become shell-parsed.
            format!(
                "printf '{TOOL_SENTINEL_START}%s\\n' '{id}'; \
                 '{bin}' --version 2>/dev/null; \
                 printf '{TOOL_SENTINEL_END}'"
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Per-tool versions parsed out of the batch probe's stdout: for each sentinel
/// block, the id keys the first dotted numeric token of the body (None when
/// the body is empty or garbage — the tool answered nothing usable). Text
/// outside the blocks (rc banners) is ignored, and a block missing its end
/// sentinel (the shell was killed mid-write) contributes nothing rather than
/// garbage. Pure.
fn parse_shell_probe_output(output: &str) -> HashMap<String, Option<String>> {
    let mut versions = HashMap::new();
    let mut rest = output;
    while let Some(start) = rest.find(TOOL_SENTINEL_START) {
        rest = &rest[start + TOOL_SENTINEL_START.len()..];
        let Some(id_end) = rest.find('\n') else { break };
        // Trimmed so a shell that sneaks in a \r or padding can't make the
        // id miss its registry lookup.
        let id = rest[..id_end].trim().to_string();
        rest = &rest[id_end + 1..];
        let Some(body_end) = rest.find(TOOL_SENTINEL_END) else { break };
        versions.insert(id, parse_version(&rest[..body_end]));
        rest = &rest[body_end + TOOL_SENTINEL_END.len()..];
    }
    versions
}

/// Run the batch probe in the user's login shell and return per-tool versions,
/// or None on Windows (no login shell) or any failure — detection then falls
/// back per tool to the directory scan. `-ilc` loads the rc files, so the
/// shell's PATH matches the user's terminal and every install method (nvm,
/// custom npm prefix, bun, pnpm, standalone installers) is covered without
/// enumeration. Bounded by SHELL_PROBE_TIMEOUT and killed on overrun; an
/// output with no sentinel blocks (a shell that choked on -i or -l) also
/// falls back. Called once per detect_tools run.
fn run_shell_probe(windows: bool) -> Option<HashMap<String, Option<String>>> {
    if windows {
        return None;
    }
    let shell = shell_binary(
        std::env::var("SHELL").ok().as_deref(),
        cfg!(target_os = "macos"),
    );
    let tools: Vec<(&str, &str)> = TOOLS.iter().map(|spec| (spec.id, spec.bin)).collect();
    let script = shell_probe_script(&tools);
    let mut child = tool_command(Path::new(&shell))
        .arg("-ilc")
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        // Never read, so a pipe would only add a way for a noisy rc to block
        // the shell on a full buffer before the probes even run.
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    // Bounded read, same 512 KiB ceiling as the status_ipc stdin path: the
    // shell exiting does not mean stdout hit EOF — an rc-backgrounded writer
    // inheriting the pipe would stall an unbounded `wait_with_output` forever
    // and let a hostile rc grow the buffer without limit. The deadline doubles
    // as the probe's whole clock.
    let stdout = child.stdout.take()?;
    let text = crate::modules::status_ipc::read_bounded_with_deadline(
        stdout,
        512 * 1024,
        SHELL_PROBE_TIMEOUT,
    );
    // Whatever the read produced, never leave the shell running.
    let _ = child.kill();
    let _ = child.wait();
    let versions = parse_shell_probe_output(&text?);
    if versions.is_empty() {
        None
    } else {
        Some(versions)
    }
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
    // One login-shell batch probe answers every tool the user's terminal can
    // see; each miss falls back per tool to the directory scan below (which is
    // the only path on Windows).
    let shell_versions = run_shell_probe(cfg!(windows));
    let tools = TOOLS
        .iter()
        .map(|spec| {
            let shell_version = shell_versions
                .as_ref()
                .and_then(|versions| versions.get(spec.id).cloned())
                .flatten();
            // A shell answer settles the tool outright, so the disk scan (a
            // stack of directory reads) only runs as the fallback: it supplies
            // the exe for the direct probe and the disk evidence for the
            // verdict (a present-but-unprobeable binary counts as installed,
            // never "not installed").
            let (version, resolved) = match shell_version {
                Some(version) => (Some(version), true),
                None => {
                    let exe = find_tool(spec.bin);
                    let version = exe.as_deref().and_then(probe_version);
                    (version, exe.is_some())
                }
            };
            let (installed, meets_min) =
                tool_verdict(version.as_deref(), resolved, spec.min_version);
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
        .env("PATH", command_path(None))
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
    fn tool_verdict_absent_tool_is_not_installed() {
        assert_eq!(tool_verdict(None, false, Some("18")), (false, false));
        assert_eq!(tool_verdict(None, false, None), (false, false));
    }

    #[test]
    fn tool_verdict_probed_version_applies_min() {
        assert_eq!(tool_verdict(Some("22.14.0"), true, Some("18")), (true, true));
        assert_eq!(tool_verdict(Some("16.0.0"), true, Some("18")), (true, false));
        assert_eq!(tool_verdict(Some("0.144.5"), true, None), (true, true));
    }

    #[test]
    fn tool_verdict_exists_but_unprobeable_no_min_is_ready() {
        // The #232 outcome: a codex/claude shim found on disk whose probe
        // failed (its node interpreter unreachable) is installed, not missing.
        assert_eq!(tool_verdict(None, true, None), (true, true));
    }

    #[test]
    fn tool_verdict_exists_but_unprobeable_with_min_fails_closed() {
        // An unknown version must never be assumed to satisfy a minimum.
        assert_eq!(tool_verdict(None, true, Some("18")), (true, false));
    }

    #[test]
    fn shell_binary_prefers_shell_env_then_os_fallback() {
        assert_eq!(shell_binary(Some("/bin/fish"), true), "/bin/fish");
        assert_eq!(shell_binary(Some("/bin/fish"), false), "/bin/fish");
        assert_eq!(shell_binary(None, true), "/bin/zsh");
        assert_eq!(shell_binary(None, false), "/bin/sh");
        // An empty SHELL is as good as unset.
        assert_eq!(shell_binary(Some(""), true), "/bin/zsh");
    }

    #[test]
    fn shell_probe_script_wraps_every_tool_in_sentinels() {
        let script = shell_probe_script(&[("claude", "claude"), ("antigravity", "agy")]);
        // One start marker per id, the probed bin between the markers, and
        // command-not-found noise dropped so an absent tool yields an empty block.
        assert_eq!(script.matches(TOOL_SENTINEL_START).count(), 2);
        assert_eq!(script.matches(TOOL_SENTINEL_END).count(), 2);
        assert!(script.contains("'claude'"));
        assert!(script.contains("'antigravity'"));
        assert!(script.contains("'claude' --version 2>/dev/null"));
        assert!(script.contains("'agy' --version 2>/dev/null"));
    }

    #[test]
    fn parse_shell_probe_output_reads_versions_per_tool() {
        // The codex id carries a \r: a CRLF-minded shell must not break the
        // registry lookup (the parser trims the id).
        let output = format!(
            "{TOOL_SENTINEL_START}claude\n2.1.195 (Claude Code)\n{TOOL_SENTINEL_END}\
             {TOOL_SENTINEL_START}codex\r\ncodex-cli 0.144.5\n{TOOL_SENTINEL_END}\
             {TOOL_SENTINEL_START}antigravity\n{TOOL_SENTINEL_END}"
        );
        let versions = parse_shell_probe_output(&output);
        assert_eq!(versions.get("claude"), Some(&Some("2.1.195".to_string())));
        assert_eq!(versions.get("codex"), Some(&Some("0.144.5".to_string())));
        // An absent tool leaves its block empty: reported as seen-but-no-version.
        assert_eq!(versions.get("antigravity"), Some(&None));
    }

    #[test]
    fn parse_shell_probe_output_survives_rc_noise_and_truncation() {
        // rc banners print outside the sentinel blocks; a timeout kill can
        // truncate the final block. Neither may corrupt the parsed results.
        let output = format!(
            "welcome to zsh!\n\
             {TOOL_SENTINEL_START}git\ngit version 2.50.1 (Apple Git-155)\n{TOOL_SENTINEL_END}\
             {TOOL_SENTINEL_START}node\nv22.14"
        );
        let versions = parse_shell_probe_output(&output);
        assert_eq!(versions.get("git"), Some(&Some("2.50.1".to_string())));
        // The truncated node block contributes nothing rather than garbage.
        assert!(!versions.contains_key("node"));
        assert_eq!(versions.len(), 1);
    }

    #[test]
    fn command_search_dirs_only_contain_absolute_entries() {
        // See command_search_dirs' doc: relative entries resolve against the
        // CWD, so neither the preferred slot nor a candidate may pass one
        // through. temp_dir() is absolute on every platform.
        let abs = std::env::temp_dir();
        let candidates = vec![
            PathBuf::from(""),
            PathBuf::from("."),
            PathBuf::from("relative/bin"),
            abs.clone(),
        ];
        for preferred in ["", ".", "./tools", "relative/bin"] {
            let dirs = command_search_dirs(Some(Path::new(preferred)), candidates.clone());
            assert_eq!(dirs, vec![abs.clone()], "for preferred {preferred:?}");
        }
    }

    #[test]
    fn command_search_dirs_prefer_the_resolved_cli_sibling() {
        // npm-installed CLIs use `#!/usr/bin/env node`; when the app found an
        // nvm shim outside its inherited PATH, its sibling Node must win, and
        // a candidate repeating it must not appear twice.
        let nvm_bin = std::env::temp_dir().join("nvm-bin");
        let other = std::env::temp_dir().join("other-bin");
        let dirs = command_search_dirs(Some(&nvm_bin), vec![other.clone(), nvm_bin.clone()]);
        assert_eq!(dirs, vec![nvm_bin, other]);
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
    fn fnm_root_honors_env_over_default() {
        // fnm allows relocating its root via $FNM_DIR (this repo's owner does),
        // so the env var must win over the per-OS default.
        let custom = fnm_root(
            Some(r"C:\custom\fnm"),
            Some(r"C:\Users\me"),
            Some(r"C:\Users\me\AppData\Roaming"),
            None,
            true,
            false,
        );
        assert_eq!(custom, Some(PathBuf::from(r"C:\custom\fnm")));
    }

    #[test]
    fn fnm_root_per_os_defaults() {
        // Windows: %APPDATA%\fnm (Roaming — fnm's data_dir default, NOT Local).
        let appdata = r"C:\Users\me\AppData\Roaming";
        let win = fnm_root(None, Some(r"C:\Users\me"), Some(appdata), None, true, false);
        assert_eq!(win, Some(PathBuf::from(appdata).join("fnm")));
        // Windows with APPDATA missing falls back to home\AppData\Roaming\fnm
        // (a stripped launch may drop APPDATA but keep USERPROFILE).
        let win_fallback = fnm_root(None, Some(r"C:\Users\me"), None, None, true, false);
        assert_eq!(
            win_fallback,
            Some(PathBuf::from(r"C:\Users\me").join("AppData").join("Roaming").join("fnm"))
        );
        // macOS: ~/Library/Application Support/fnm
        let mac = fnm_root(None, Some("/Users/me"), None, None, false, true);
        assert_eq!(
            mac,
            Some(PathBuf::from("/Users/me/Library/Application Support/fnm"))
        );
        // Other Unix: $XDG_DATA_HOME/fnm when set, else ~/.local/share/fnm
        let xdg = fnm_root(None, Some("/home/me"), None, Some("/home/me/.xdg"), false, false);
        assert_eq!(xdg, Some(PathBuf::from("/home/me/.xdg/fnm")));
        let linux = fnm_root(None, Some("/home/me"), None, None, false, false);
        assert_eq!(linux, Some(PathBuf::from("/home/me/.local/share/fnm")));
        // A set XDG_DATA_HOME must still resolve when HOME is absent (a stripped
        // GUI launch can hand us no HOME) — it must not fall through to None.
        let xdg_no_home = fnm_root(None, None, None, Some("/data/.xdg"), false, false);
        assert_eq!(xdg_no_home, Some(PathBuf::from("/data/.xdg/fnm")));
    }

    #[test]
    fn fnm_dirs_windows_uses_installation_dir_without_a_bin_subdir() {
        // On Windows node.exe and the `npm i -g` shims sit directly in
        // `installation` (npm's prefix), so no `bin` segment is appended.
        let versions = vec!["v24.17.0".to_string()];
        let root = PathBuf::from(r"C:\Users\me\AppData\Roaming\fnm");
        let dirs = fnm_dirs(&root, &versions, true);
        assert!(dirs.contains(&root.join("aliases").join("default")));
        assert!(dirs.contains(
            &root
                .join("node-versions")
                .join("v24.17.0")
                .join("installation")
        ));
    }

    #[test]
    fn fnm_dirs_unix_appends_bin() {
        // On Unix the executables live in `installation/bin`.
        let versions = vec!["v22.14.0".to_string()];
        let root = PathBuf::from("/home/me/.local/share/fnm");
        let dirs = fnm_dirs(&root, &versions, false);
        assert!(dirs.contains(&root.join("aliases").join("default").join("bin")));
        assert!(dirs.contains(
            &root
                .join("node-versions")
                .join("v22.14.0")
                .join("installation")
                .join("bin")
        ));
    }

    #[test]
    fn read_fnm_node_versions_lists_installs_and_skips_downloads() {
        // A controlled <root>/node-versions tree: the reader returns each version
        // dir and skips fnm's `.downloads` staging dir (a dotfile, not a version).
        let base = std::env::temp_dir().join("tempo_setup_fnm_read_test");
        let _ = std::fs::remove_dir_all(&base);
        let node_versions = base.join("node-versions");
        std::fs::create_dir_all(node_versions.join("v24.17.0").join("installation")).unwrap();
        std::fs::create_dir_all(node_versions.join("v22.23.0").join("installation")).unwrap();
        std::fs::create_dir_all(node_versions.join(".downloads")).unwrap();

        let versions = read_fnm_node_versions(&base);
        assert!(versions.contains(&"v24.17.0".to_string()));
        assert!(versions.contains(&"v22.23.0".to_string()));
        assert!(!versions.iter().any(|v| v == ".downloads"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn read_fnm_node_versions_empty_when_absent() {
        // No fnm install: empty, never an error.
        let missing = std::env::temp_dir().join("tempo_setup_fnm_absent_test_xyz");
        let _ = std::fs::remove_dir_all(&missing);
        assert!(read_fnm_node_versions(&missing).is_empty());
    }

    #[test]
    fn resolves_a_tool_present_only_under_an_fnm_windows_install() {
        // The Windows fnm bug: `claude.cmd` from `npm i -g` lives in the node
        // version's `installation` dir (npm's prefix there) and never on the
        // GUI launch's PATH. End-to-end, detection must still resolve it from the
        // fnm dirs alone.
        let base = std::env::temp_dir().join("tempo_setup_e2e_fnm");
        let _ = std::fs::remove_dir_all(&base);
        let install = base
            .join("node-versions")
            .join("v24.17.0")
            .join("installation");
        std::fs::create_dir_all(&install).unwrap();
        std::fs::write(install.join("claude.cmd"), b"@echo off\n").unwrap();

        // No PATH involved — only the fnm dirs discovered from the root.
        let versions = read_fnm_node_versions(&base);
        let dirs = fnm_dirs(&base, &versions, true);
        let found = resolve_in_dirs(&exe_names("claude", true), &dirs);

        assert!(found.is_some(), "claude.cmd under an fnm installation must be found");
        assert!(found
            .unwrap()
            .ends_with(PathBuf::from("installation").join("claude.cmd")));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    #[ignore = "env-dependent: run manually on a machine with a real login shell"]
    fn real_shell_probe_reports_installed_tools() {
        // Proof on the real machine: the login-shell batch probe returns a
        // non-empty map and sees at least one real tool. Run with:
        //   cargo test -p tempo-term real_shell_probe -- --ignored --nocapture
        let versions = run_shell_probe(false);
        println!("shell probe versions: {versions:?}");
        assert!(versions.is_some(), "expected the login shell probe to produce blocks");
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
