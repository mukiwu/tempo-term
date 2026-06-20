//! Pull-request tracking for workspace cards. Two sources are supported: the
//! `gh` CLI (when installed) and the GitHub REST API with a token stored in the
//! OS keychain. Either may be unavailable; callers treat a None result as
//! "nothing to show" and degrade gracefully.

use std::process::Command;

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

/// Whether the `gh` CLI is available on PATH.
#[tauri::command]
pub fn gh_available() -> bool {
    Command::new("gh")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// The PR for `branch` via the `gh` CLI, run inside `cwd`. None when gh reports
/// no PR (a non-zero exit) or gh is missing.
#[tauri::command]
pub fn pr_via_gh(cwd: String, branch: Option<String>) -> Result<Option<PrInfo>, String> {
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
    let output = match Command::new("gh").args(&args).current_dir(&cwd).output() {
        Ok(output) => output,
        // gh not installed: not an error, just nothing to show.
        Err(_) => return Ok(None),
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
        assert_eq!(pr_via_gh(".".into(), Some("-x".into())), Ok(None));
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
}
