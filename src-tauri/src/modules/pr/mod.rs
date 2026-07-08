//! Pull-request tracking for workspace cards. Two sources are supported: the
//! `gh` CLI (when installed) and the GitHub REST API with a token stored in the
//! OS keychain. Either may be unavailable; callers treat a None result as
//! "nothing to show" and degrade gracefully.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use wait_timeout::ChildExt;

use serde::Serialize;
use serde_json::Value;

use crate::modules::secrets;

/// The keychain account the GitHub API token is stored under (see secrets).
const TOKEN_ACCOUNT: &str = "github";

/// A pull request summarized for a card. `state` is one of "open", "draft",
/// "merged", "closed".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PrInfo {
    pub number: u64,
    pub state: String,
    pub url: String,
    pub title: Option<String>,
}

/// Extract the GitHub `(owner, repo)` from a remote URL in either ssh
/// (`git@github.com:owner/repo.git`) or https
/// (`https://github.com/owner/repo(.git)`) form. None for non-GitHub remotes.
pub fn parse_owner_repo(url: &str) -> Option<(String, String)> {
    let url = url.trim().trim_end_matches('/');
    let url = url.strip_suffix(".git").unwrap_or(url);
    let idx = url.find("github.com")?;
    let path = url[idx + "github.com".len()..].trim_start_matches([':', '/']);
    let mut parts = path.splitn(2, '/');
    let owner = parts.next().filter(|s| !s.is_empty())?;
    let repo = parts.next().filter(|s| !s.is_empty())?;
    Some((owner.to_string(), repo.to_string()))
}

/// Map a `gh` PR `state` ("OPEN"/"CLOSED"/"MERGED") plus draft flag to our state.
pub fn normalize_gh_state(state: &str, is_draft: bool) -> String {
    match state.to_ascii_uppercase().as_str() {
        "MERGED" => "merged",
        "CLOSED" => "closed",
        "OPEN" if is_draft => "draft",
        _ => "open",
    }
    .to_string()
}

/// Map a GitHub API PR (`state` "open"/"closed", `draft`, whether merged) to our
/// state.
pub fn normalize_api_state(state: &str, draft: bool, merged: bool) -> String {
    if merged {
        "merged"
    } else if state.eq_ignore_ascii_case("closed") {
        "closed"
    } else if draft {
        "draft"
    } else {
        "open"
    }
    .to_string()
}

/// Build a PrInfo from `gh pr view --json ...` output.
fn pr_from_gh_json(value: &Value) -> Option<PrInfo> {
    let number = value.get("number")?.as_u64()?;
    let state = value.get("state")?.as_str()?;
    let is_draft = value.get("isDraft").and_then(Value::as_bool).unwrap_or(false);
    let url = value.get("url").and_then(Value::as_str).unwrap_or("").to_string();
    let title = value.get("title").and_then(Value::as_str).map(str::to_string);
    Some(PrInfo {
        number,
        state: normalize_gh_state(state, is_draft),
        url,
        title,
    })
}

/// Build a PrInfo from a GitHub REST API pull-request object.
fn pr_from_api_json(value: &Value) -> Option<PrInfo> {
    let number = value.get("number")?.as_u64()?;
    let state = value.get("state").and_then(Value::as_str).unwrap_or("open");
    let draft = value.get("draft").and_then(Value::as_bool).unwrap_or(false);
    let merged = value.get("merged_at").map(|v| !v.is_null()).unwrap_or(false);
    let url = value.get("html_url").and_then(Value::as_str).unwrap_or("").to_string();
    let title = value.get("title").and_then(Value::as_str).map(str::to_string);
    Some(PrInfo {
        number,
        state: normalize_api_state(state, draft, merged),
        url,
        title,
    })
}

/// The `origin` remote URL for the repository containing `cwd`, if any.
fn remote_origin_url(cwd: &str) -> Option<String> {
    let repo = git2::Repository::discover(cwd).ok()?;
    let remote = repo.find_remote("origin").ok()?;
    remote.url().map(str::to_string)
}

/// Directories to search for a CLI binary, on top of `PATH`. A GUI launch hands
/// the app a reduced environment that can omit user install dirs — Homebrew on
/// macOS, winget/scoop/choco shims on Windows — so we append the usual
/// per-platform locations. `windows` selects the platform layout; pure so it can
/// be tested on any host without the real env.
fn cli_search_dirs(path_env: Option<&str>, home: Option<&str>, windows: bool) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = match path_env {
        Some(path) => std::env::split_paths(path).collect(),
        None => Vec::new(),
    };
    if windows {
        // winget/MSI land in Program Files; chocolatey shims its own bin.
        for extra in [
            r"C:\Program Files\GitHub CLI",
            r"C:\Program Files (x86)\GitHub CLI",
            r"C:\ProgramData\chocolatey\bin",
        ] {
            dirs.push(PathBuf::from(extra));
        }
        if let Some(home) = home {
            // scoop puts shims under the user profile.
            dirs.push(PathBuf::from(home).join("scoop").join("shims"));
        }
    } else {
        for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
            dirs.push(PathBuf::from(extra));
        }
        if let Some(home) = home {
            dirs.push(PathBuf::from(home).join(".local").join("bin"));
        }
    }
    dirs
}

/// Candidate file names for an executable. Windows binaries carry an extension
/// (`gh.exe`), so a bare `gh` never matches on disk — try the common executable
/// extensions there; elsewhere the stem itself is the only candidate. Pure for
/// testing.
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

/// Absolute path to the `gh` binary, searching PATH plus the common install
/// dirs a GUI launch drops, or None when it isn't installed. On Windows this
/// resolves `gh.exe` (a bare `gh` file never exists there) and honours
/// `USERPROFILE` as the home dir, since `HOME` is usually unset.
fn find_gh() -> Option<PathBuf> {
    let path_env = std::env::var("PATH").ok();
    let home = std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok());
    let windows = cfg!(windows);
    let names = exe_names("gh", windows);
    for dir in cli_search_dirs(path_env.as_deref(), home.as_deref(), windows) {
        for name in &names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Build a `Command` for the `gh` binary with the console suppressed on Windows.
/// A release build has no console of its own (windows_subsystem = "windows" in
/// main.rs), so each un-flagged spawn allocates a fresh console that flashes a
/// window — and PR lookups poll on a timer, so those flashes are constant. See
/// git::run_git for the same reasoning; CREATE_NO_WINDOW is a no-op on a debug
/// build that already owns a console.
fn gh_command(gh: &std::path::Path) -> Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut command = Command::new(gh);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Ceiling on any single `gh` invocation. PR lookups run on a timer, so a hung
/// gh (network stall, an interactive auth prompt) must not pile up on the
/// caller's threads — bound the wait and give up instead.
const GH_TIMEOUT: Duration = Duration::from_secs(5);

/// Run a prepared `gh` command to completion, killing it if it outruns
/// GH_TIMEOUT. Returns the captured output, or None on spawn failure or timeout.
///
/// gh's output here (`--version`, a single `pr view --json`) is small — well
/// under the OS pipe buffer — so waiting on the child before draining stdout
/// cannot deadlock. A larger-output gh call would need concurrent draining.
fn run_gh(mut command: Command) -> Option<std::process::Output> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    match child.wait_timeout(GH_TIMEOUT) {
        Ok(Some(_)) => child.wait_with_output().ok(),
        // Timed out, or the wait itself failed: kill and reap either way so a
        // hung gh never lingers as a zombie/background process.
        Ok(None) | Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

/// Blocking probe: spawn `gh --version` and check it succeeds.
fn gh_available_uncached() -> bool {
    let Some(gh) = find_gh() else {
        return false;
    };
    let mut command = gh_command(&gh);
    command.arg("--version");
    run_gh(command)
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Sticky cache for a POSITIVE `gh` probe only. `gh_available` runs before every
/// PR refresh, so a workspace with N cards would otherwise fork `gh` N times per
/// focus. A negative result is deliberately NOT cached: the first probe can be a
/// transient false-negative (a cold-start `gh --version` timeout, or `find_gh`
/// not yet resolved), and caching that would silently disable gh for the whole
/// session — every card — until restart. Not caching false lets it self-heal on
/// the next call. `false` here means "no positive confirmed yet".
static GH_AVAILABLE: Mutex<bool> = Mutex::new(false);

/// Whether the `gh` CLI is available. Async so the subprocess probe runs off the
/// main GUI thread; the positive result is cached (single-flight) so a burst of
/// cards shares one probe, while a negative result re-probes so a transient miss
/// recovers on its own.
#[tauri::command]
pub async fn gh_available() -> bool {
    tauri::async_runtime::spawn_blocking(|| gh_available_via(&GH_AVAILABLE, gh_available_uncached))
        .await
        .unwrap_or(false)
}

/// Read-through cache that memoizes only a positive probe. The probe runs while
/// the lock is held, so concurrent callers share one probe instead of forking a
/// herd; a `false` is not stored, so it re-probes next time. Generic over the
/// cache + probe so the caching behaviour is unit-testable without spawning gh.
fn gh_available_via(cache: &Mutex<bool>, probe: impl FnOnce() -> bool) -> bool {
    let mut confirmed = cache.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if *confirmed {
        return true;
    }
    let available = probe();
    if available {
        *confirmed = true;
    }
    available
}

/// The PR for `branch` via the `gh` CLI, run inside `cwd`. None when gh reports
/// no PR (a non-zero exit) or gh is missing. Async + spawn_blocking so the
/// `gh pr view` spawn (a subprocess that also hits the GitHub API) never runs on
/// the main GUI thread: the workspace panel fans this out across every card on
/// focus, and a burst of synchronous spawns here froze the whole UI for seconds.
#[tauri::command]
pub async fn pr_via_gh(cwd: String, branch: Option<String>) -> Result<Option<PrInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || pr_via_gh_blocking(cwd, branch))
        .await
        .map_err(|e| e.to_string())?
}

fn pr_via_gh_blocking(cwd: String, branch: Option<String>) -> Result<Option<PrInfo>, String> {
    let mut args: Vec<&str> = vec!["pr", "view"];
    let branch = branch.unwrap_or_default();
    if !branch.is_empty() {
        // A branch name beginning with '-' would be read by gh as a flag (argv
        // flag smuggling). Real branches never start with '-', so refuse rather
        // than risk smuggling an option in; the card simply shows no PR.
        if branch.starts_with('-') {
            return Ok(None);
        }
        args.push(&branch);
    }
    args.extend(["--json", "number,state,isDraft,url,title"]);
    // gh not installed: not an error, just nothing to show.
    let Some(gh) = find_gh() else {
        return Ok(None);
    };
    let mut command = gh_command(&gh);
    command.args(&args).current_dir(&cwd);
    let output = match run_gh(command) {
        Some(output) => output,
        None => return Ok(None),
    };
    if !output.status.success() {
        return Ok(None);
    }
    let value: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    Ok(pr_from_gh_json(&value))
}

/// The PR for `branch` via the GitHub REST API, using the stored token. None
/// when there is no token, the remote is not GitHub, or no PR exists.
#[tauri::command]
pub async fn pr_via_api(cwd: String, branch: String) -> Result<Option<PrInfo>, String> {
    let token = match secrets::get_key(TOKEN_ACCOUNT)? {
        Some(token) if !token.is_empty() => token,
        _ => return Ok(None),
    };
    let (owner, repo) = match remote_origin_url(&cwd).as_deref().and_then(parse_owner_repo) {
        Some(pair) => pair,
        None => return Ok(None),
    };
    // Build the query with reqwest so the branch (which may contain characters
    // like '/') is URL-encoded rather than formatted raw into the URL.
    let api = format!("https://api.github.com/repos/{owner}/{repo}/pulls");
    let head = format!("{owner}:{branch}");
    let client = reqwest::Client::new();
    let response = client
        .get(&api)
        .query(&[("head", head.as_str()), ("state", "all"), ("per_page", "1")])
        .header("User-Agent", "tempo-term")
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(body.as_array().and_then(|a| a.first()).and_then(pr_from_api_json))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gh_available_caches_positive_but_reprobes_after_false() {
        use std::cell::Cell;
        let cache = Mutex::new(false);
        let calls = Cell::new(0);
        let probe = |result: bool| {
            calls.set(calls.get() + 1);
            result
        };
        // A false result is not cached, so each call re-probes (self-heals a
        // transient false-negative instead of disabling gh for the session).
        assert!(!gh_available_via(&cache, || probe(false)));
        assert!(!gh_available_via(&cache, || probe(false)));
        assert_eq!(calls.get(), 2, "false must re-probe, not stick");
        // The first positive is cached and sticks; later calls never re-probe.
        assert!(gh_available_via(&cache, || probe(true)));
        assert_eq!(calls.get(), 3);
        assert!(gh_available_via(&cache, || panic!("cached positive must not re-probe")));
        assert_eq!(calls.get(), 3);
    }

    #[test]
    fn parses_ssh_remote() {
        assert_eq!(
            parse_owner_repo("git@github.com:mukiwu/tempo-term.git"),
            Some(("mukiwu".into(), "tempo-term".into()))
        );
    }

    #[test]
    fn parses_https_remote_with_and_without_git_suffix() {
        assert_eq!(
            parse_owner_repo("https://github.com/mukiwu/tempo-term.git"),
            Some(("mukiwu".into(), "tempo-term".into()))
        );
        assert_eq!(
            parse_owner_repo("https://github.com/mukiwu/tempo-term"),
            Some(("mukiwu".into(), "tempo-term".into()))
        );
    }

    #[test]
    fn rejects_non_github_and_garbage() {
        assert_eq!(parse_owner_repo("git@gitlab.com:foo/bar.git"), None);
        assert_eq!(parse_owner_repo("not a url"), None);
        assert_eq!(parse_owner_repo("https://github.com/"), None);
    }

    #[test]
    fn gh_state_maps_draft_and_merged() {
        assert_eq!(normalize_gh_state("OPEN", true), "draft");
        assert_eq!(normalize_gh_state("OPEN", false), "open");
        assert_eq!(normalize_gh_state("MERGED", false), "merged");
        assert_eq!(normalize_gh_state("CLOSED", false), "closed");
    }

    #[test]
    fn api_state_prefers_merged_then_closed_then_draft() {
        assert_eq!(normalize_api_state("closed", false, true), "merged");
        assert_eq!(normalize_api_state("closed", false, false), "closed");
        assert_eq!(normalize_api_state("open", true, false), "draft");
        assert_eq!(normalize_api_state("open", false, false), "open");
    }

    #[test]
    fn pr_via_gh_refuses_a_flag_like_branch() {
        // A branch starting with '-' must not reach gh as a positional arg.
        assert_eq!(pr_via_gh_blocking(".".into(), Some("-x".into())), Ok(None));
    }

    #[test]
    fn builds_pr_from_gh_json() {
        let value = serde_json::json!({
            "number": 42, "state": "OPEN", "isDraft": true,
            "url": "https://github.com/o/r/pull/42", "title": "Add thing"
        });
        let pr = pr_from_gh_json(&value).unwrap();
        assert_eq!(pr.number, 42);
        assert_eq!(pr.state, "draft");
        assert_eq!(pr.title.as_deref(), Some("Add thing"));
    }

    #[test]
    fn builds_pr_from_api_json_marks_merged() {
        let value = serde_json::json!({
            "number": 7, "state": "closed", "draft": false,
            "merged_at": "2026-01-01T00:00:00Z",
            "html_url": "https://github.com/o/r/pull/7", "title": "Done"
        });
        let pr = pr_from_api_json(&value).unwrap();
        assert_eq!(pr.number, 7);
        assert_eq!(pr.state, "merged");
        assert_eq!(pr.url, "https://github.com/o/r/pull/7");
    }

    #[test]
    fn cli_search_dirs_adds_common_install_locations_to_a_minimal_path() {
        // A GUI launch (Finder/Dock) hands the app a minimal PATH without
        // Homebrew, so gh "isn't found" even when installed. The search must
        // still cover the usual install dirs. Build PATH with join_paths so the
        // host's separator is used and split_paths round-trips on any runner.
        let path = std::env::join_paths(["/usr/bin", "/bin"]).unwrap();
        let dirs = cli_search_dirs(path.to_str(), Some("/Users/me"), false);
        assert!(dirs.contains(&PathBuf::from("/usr/bin"))); // PATH entries kept
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin"))); // Apple Silicon brew
        assert!(dirs.contains(&PathBuf::from("/usr/local/bin"))); // Intel brew
        assert!(dirs.contains(&PathBuf::from("/Users/me/.local/bin"))); // home bin
    }

    #[test]
    fn cli_search_dirs_works_without_a_path_or_home() {
        let dirs = cli_search_dirs(None, None, false);
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(!dirs.iter().any(|d| d.ends_with(".local/bin")));
    }

    #[test]
    fn cli_search_dirs_windows_uses_windows_install_locations() {
        // The Windows GUI launch can hand the app a PATH without the gh install
        // dir, so the search must cover the standard Windows locations and not
        // leak the macOS ones. Build expected dirs with join (not backslash
        // literals) so component comparison holds on a non-Windows host too.
        let home = PathBuf::from(r"C:\Users\me");
        let dirs = cli_search_dirs(None, Some(r"C:\Users\me"), true);
        assert!(dirs.contains(&PathBuf::from(r"C:\Program Files\GitHub CLI")));
        assert!(dirs.contains(&home.join("scoop").join("shims"))); // scoop shims
        assert!(!dirs.contains(&PathBuf::from("/opt/homebrew/bin"))); // no macOS leak
    }

    #[test]
    fn exe_names_appends_windows_extensions_only_on_windows() {
        // The heart of issue #87: on Windows the binary is gh.exe, so probing a
        // bare "gh" never matches and gh is reported missing even when on PATH.
        assert_eq!(exe_names("gh", false), vec!["gh".to_string()]);
        let win = exe_names("gh", true);
        assert!(win.contains(&"gh.exe".to_string()));
        assert!(!win.contains(&"gh".to_string()));
    }
}
