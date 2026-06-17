//! Git integration backed by libgit2 (git2 crate): status, staging and commit.

use std::path::Path;

use git2::{Repository, Signature, Status, StatusOptions};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileStatus {
    pub path: String,
    pub staged: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitStatus {
    pub branch: Option<String>,
    pub staged: Vec<FileStatus>,
    pub unstaged: Vec<FileStatus>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub id: String,
    pub summary: String,
    pub author: String,
    pub timestamp: i64,
}

/// A ref decoration attached to a commit in the graph view. `kind` is one of
/// "head" (the current branch), "branch" (another local branch), "tag", or
/// "remote" (read-only, no context-menu actions).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GraphRef {
    pub name: String,
    pub kind: String,
}

/// One node of the commit DAG rendered by the Git graph tab. Shapes match the
/// frontend `CommitNode` type: short hash, parent short hashes, author, a
/// preformatted date string, the subject, and any ref decorations.
#[derive(Debug, Clone, Serialize)]
pub struct GraphCommit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub date: String,
    pub message: String,
    pub refs: Vec<GraphRef>,
}

/// A page of graph commits plus whether more history exists past `commits`.
#[derive(Debug, Clone, Serialize)]
pub struct GraphLog {
    pub commits: Vec<GraphCommit>,
    #[serde(rename = "hasMore")]
    pub has_more: bool,
}

/// A local branch entry for the branch list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BranchInfo {
    pub name: String,
    #[serde(rename = "isCurrent")]
    pub is_current: bool,
}

/// Short code for the staged (index vs HEAD) side of a status, if any.
fn index_status(status: Status) -> Option<&'static str> {
    if status.contains(Status::INDEX_NEW) {
        Some("A")
    } else if status.contains(Status::INDEX_MODIFIED) {
        Some("M")
    } else if status.contains(Status::INDEX_DELETED) {
        Some("D")
    } else if status.contains(Status::INDEX_RENAMED) {
        Some("R")
    } else if status.contains(Status::INDEX_TYPECHANGE) {
        Some("T")
    } else {
        None
    }
}

/// Short code for the unstaged (workdir vs index) side of a status, if any.
fn worktree_status(status: Status) -> Option<&'static str> {
    if status.contains(Status::WT_NEW) {
        Some("?")
    } else if status.contains(Status::WT_MODIFIED) {
        Some("M")
    } else if status.contains(Status::WT_DELETED) {
        Some("D")
    } else if status.contains(Status::WT_RENAMED) {
        Some("R")
    } else if status.contains(Status::WT_TYPECHANGE) {
        Some("T")
    } else {
        None
    }
}

/// Discover the repository root that contains `path`, if any.
pub fn resolve_repo(path: &str) -> Option<String> {
    let repo = Repository::discover(path).ok()?;
    repo.workdir()
        .map(|p| p.to_string_lossy().trim_end_matches('/').to_string())
}

pub fn status(repo_path: &str) -> Result<GitStatus, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.message().to_string())?;
    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let mut options = StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo
        .statuses(Some(&mut options))
        .map_err(|e| e.message().to_string())?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or_default().to_string();
        let status = entry.status();
        if let Some(code) = index_status(status) {
            staged.push(FileStatus {
                path: path.clone(),
                staged: true,
                status: code.to_string(),
            });
        }
        if let Some(code) = worktree_status(status) {
            unstaged.push(FileStatus {
                path,
                staged: false,
                status: code.to_string(),
            });
        }
    }

    Ok(GitStatus {
        branch,
        staged,
        unstaged,
    })
}

pub fn stage(repo_path: &str, path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.message().to_string())?;
    let mut index = repo.index().map_err(|e| e.message().to_string())?;
    let rel = Path::new(path);
    // add_path stages additions/modifications; a removed file needs remove_path.
    index
        .add_path(rel)
        .or_else(|_| index.remove_path(rel))
        .map_err(|e| e.message().to_string())?;
    index.write().map_err(|e| e.message().to_string())
}

pub fn unstage(repo_path: &str, path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.message().to_string())?;
    let head_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let result = match head_commit {
        Some(head) => repo
            .reset_default(Some(head.as_object()), [path])
            .map_err(|e| e.message().to_string()),
        None => {
            // No commits yet: just remove the entry from the index.
            let mut index = repo.index().map_err(|e| e.message().to_string())?;
            index
                .remove_path(Path::new(path))
                .map_err(|e| e.message().to_string())
                .and_then(|_| index.write().map_err(|e| e.message().to_string()))
        }
    };
    result
}

pub fn commit(repo_path: &str, message: &str) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("commit message must not be empty".to_string());
    }
    let repo = Repository::open(repo_path).map_err(|e| e.message().to_string())?;
    let mut index = repo.index().map_err(|e| e.message().to_string())?;
    let tree_oid = index.write_tree().map_err(|e| e.message().to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.message().to_string())?;

    let signature = repo
        .signature()
        .or_else(|_| Signature::now("TempoTerm", "tempoterm@localhost"))
        .map_err(|e| e.message().to_string())?;

    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();

    let oid = repo
        .commit(Some("HEAD"), &signature, &signature, message, &tree, &parents)
        .map_err(|e| e.message().to_string())?;
    Ok(oid.to_string())
}

pub fn log(repo_path: &str, limit: usize) -> Result<Vec<CommitInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.message().to_string())?;
    let mut revwalk = repo.revwalk().map_err(|e| e.message().to_string())?;
    if revwalk.push_head().is_err() {
        return Ok(Vec::new());
    }

    let mut commits = Vec::new();
    for oid in revwalk.take(limit) {
        let oid = oid.map_err(|e| e.message().to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.message().to_string())?;
        let id = oid.to_string();
        commits.push(CommitInfo {
            id: id.chars().take(7).collect(),
            summary: commit.summary().unwrap_or_default().to_string(),
            author: commit.author().name().unwrap_or_default().to_string(),
            timestamp: commit.time().seconds(),
        });
    }
    Ok(commits)
}

#[tauri::command]
pub fn git_resolve_repo(path: String) -> Option<String> {
    resolve_repo(&path)
}

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<GitStatus, String> {
    status(&repo_path)
}

#[tauri::command]
pub fn git_stage(repo_path: String, path: String) -> Result<(), String> {
    stage(&repo_path, &path)
}

#[tauri::command]
pub fn git_unstage(repo_path: String, path: String) -> Result<(), String> {
    unstage(&repo_path, &path)
}

#[tauri::command]
pub fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    commit(&repo_path, &message)
}

/// Run a git subcommand against `repo_path` using the system git binary. This
/// reuses the user's configured credentials/helpers, which matters for push.
fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Reject a value that begins with `-`. Branch/tag names and commit hashes are
/// passed to `git` as positional arguments; a leading dash would let a crafted
/// value (e.g. from a malicious repo's ref names) be smuggled in as a flag
/// (argv flag smuggling). This is the single thing that closes that vector: an
/// argument can only be read as a flag if it starts with `-`.
fn ensure_not_flag(value: &str) -> Result<(), String> {
    if value.starts_with('-') {
        return Err(format!("invalid value, looks like a flag: {value}"));
    }
    Ok(())
}

/// The staged (`--cached`) or unstaged diff as a unified-diff string.
pub fn diff(repo_path: &str, staged: bool) -> Result<String, String> {
    if staged {
        run_git(repo_path, &["diff", "--cached"])
    } else {
        run_git(repo_path, &["diff"])
    }
}

/// Push the current branch to its remote.
pub fn push(repo_path: &str) -> Result<String, String> {
    run_git(repo_path, &["push"])
}

/// Parse a `git log --decorate=full` decoration string (the `%d` placeholder,
/// e.g. " (HEAD -> refs/heads/main, tag: refs/tags/v1.0, refs/remotes/origin/main)")
/// into structured refs. Pure so it can be unit tested without a repo.
pub fn parse_refs(decoration: &str) -> Vec<GraphRef> {
    let outer = decoration.trim();
    let outer = outer.strip_prefix('(').unwrap_or(outer);
    let outer = outer.strip_suffix(')').unwrap_or(outer);
    let trimmed = outer.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    trimmed
        .split(", ")
        .filter_map(|token| {
            let token = token.trim();
            if token.is_empty() {
                return None;
            }
            if let Some(rest) = token.strip_prefix("HEAD -> ") {
                let name = rest.trim().strip_prefix("refs/heads/").unwrap_or(rest.trim());
                return Some(GraphRef {
                    name: name.to_string(),
                    kind: "head".to_string(),
                });
            }
            if token == "HEAD" {
                return Some(GraphRef {
                    name: "HEAD".to_string(),
                    kind: "head".to_string(),
                });
            }
            if let Some(rest) = token.strip_prefix("tag: ") {
                let name = rest.trim().strip_prefix("refs/tags/").unwrap_or(rest.trim());
                return Some(GraphRef {
                    name: name.to_string(),
                    kind: "tag".to_string(),
                });
            }
            if let Some(rest) = token.strip_prefix("refs/heads/") {
                return Some(GraphRef {
                    name: rest.to_string(),
                    kind: "branch".to_string(),
                });
            }
            if let Some(rest) = token.strip_prefix("refs/remotes/") {
                return Some(GraphRef {
                    name: rest.to_string(),
                    kind: "remote".to_string(),
                });
            }
            if let Some(rest) = token.strip_prefix("refs/tags/") {
                return Some(GraphRef {
                    name: rest.to_string(),
                    kind: "tag".to_string(),
                });
            }
            // Unknown namespace (refs/notes, stash, ...) — not a deletable branch/tag.
            Some(GraphRef {
                name: token.to_string(),
                kind: "unknown".to_string(),
            })
        })
        .collect()
}

/// Parse one `git log` line (our pipe-delimited format) into a graph commit.
/// Returns `None` for blank lines. Pure for unit testing.
fn parse_graph_commit(line: &str) -> Option<GraphCommit> {
    if line.trim().is_empty() {
        return None;
    }
    let parts: Vec<&str> = line.split('|').collect();
    Some(GraphCommit {
        hash: parts.first().unwrap_or(&"").trim().to_string(),
        parents: parts
            .get(1)
            .unwrap_or(&"")
            .split_whitespace()
            .map(String::from)
            .collect(),
        author: parts.get(2).unwrap_or(&"").trim().to_string(),
        date: parts.get(3).unwrap_or(&"").trim().to_string(),
        refs: parse_refs(parts.get(4).unwrap_or(&"")),
        // The subject may itself contain "|", so re-join the tail.
        message: parts
            .get(5..)
            .map(|rest| rest.join("|"))
            .unwrap_or_default()
            .trim()
            .to_string(),
    })
}

/// Read the commit DAG for the Git graph view. `limit` caps how many commits
/// are returned; one extra is fetched internally to compute `has_more`.
pub fn graph_log(repo_path: &str, limit: usize, skip: usize) -> Result<GraphLog, String> {
    let limit = limit.clamp(1, 2000);
    let max_count = format!("--max-count={}", limit + 1);
    let skip_arg = format!("--skip={skip}");
    let stdout = run_git(
        repo_path,
        &[
            "log",
            "--all",
            "--topo-order",
            "--decorate=full",
            "--pretty=format:%h|%p|%an|%ad|%d|%s",
            "--date=format-local:%Y-%m-%d %H:%M",
            &max_count,
            &skip_arg,
        ],
    )
    // An empty repo (no commits yet) makes `git log` exit non-zero; treat that
    // as an empty graph rather than an error.
    .unwrap_or_default();

    let mut commits: Vec<GraphCommit> = stdout.lines().filter_map(parse_graph_commit).collect();
    let has_more = commits.len() > limit;
    if has_more {
        commits.truncate(limit);
    }
    Ok(GraphLog { commits, has_more })
}

/// List local branches, marking the current one.
pub fn branches(repo_path: &str) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.message().to_string())?;
    let head_name = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let mut out = Vec::new();
    let iter = repo
        .branches(Some(git2::BranchType::Local))
        .map_err(|e| e.message().to_string())?;
    for entry in iter {
        let (branch, _) = entry.map_err(|e| e.message().to_string())?;
        if let Some(name) = branch.name().map_err(|e| e.message().to_string())? {
            let name = name.to_string();
            let is_current = Some(&name) == head_name.as_ref();
            out.push(BranchInfo { name, is_current });
        }
    }
    Ok(out)
}

/// Check out an existing branch.
pub fn branch_checkout(repo_path: &str, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("branch name is required".to_string());
    }
    ensure_not_flag(name)?;
    run_git(repo_path, &["checkout", name]).map(|_| ())
}

/// Create a new branch pointing at `commit` and switch to it.
pub fn branch_create_at(repo_path: &str, name: &str, commit: &str) -> Result<(), String> {
    let name = name.trim();
    let commit = commit.trim();
    if name.is_empty() {
        return Err("branch name is required".to_string());
    }
    if commit.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(name)?;
    ensure_not_flag(commit)?;
    run_git(repo_path, &["checkout", "-b", name, commit]).map(|_| ())
}

/// Delete a local branch. `force` allows deleting unmerged branches.
pub fn branch_delete(repo_path: &str, name: &str, force: bool) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("branch name is required".to_string());
    }
    ensure_not_flag(name)?;
    let flag = if force { "-D" } else { "-d" };
    run_git(repo_path, &["branch", flag, name]).map(|_| ())
}

/// Create a tag at `commit`. With a non-empty `message` it is annotated.
pub fn tag_create(
    repo_path: &str,
    name: &str,
    commit: &str,
    message: Option<&str>,
) -> Result<(), String> {
    let name = name.trim();
    let commit = commit.trim();
    if name.is_empty() {
        return Err("tag name is required".to_string());
    }
    if commit.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(name)?;
    ensure_not_flag(commit)?;
    match message.map(str::trim).filter(|m| !m.is_empty()) {
        Some(msg) => run_git(repo_path, &["tag", "-a", name, commit, "-m", msg]),
        None => run_git(repo_path, &["tag", name, commit]),
    }
    .map(|_| ())
}

/// Delete a tag.
pub fn tag_delete(repo_path: &str, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("tag name is required".to_string());
    }
    ensure_not_flag(name)?;
    run_git(repo_path, &["tag", "-d", name]).map(|_| ())
}

/// Merge `name` into the current branch (always a merge commit, --no-ff).
pub fn merge(repo_path: &str, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("branch name is required".to_string());
    }
    ensure_not_flag(name)?;
    run_git(repo_path, &["merge", "--no-ff", name]).map(|_| ())
}

/// Revert `commit` with a new commit (--no-edit).
pub fn revert(repo_path: &str, commit: &str) -> Result<(), String> {
    let commit = commit.trim();
    if commit.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(commit)?;
    run_git(repo_path, &["revert", commit, "--no-edit"]).map(|_| ())
}

/// Cherry-pick `commit` onto the current branch.
pub fn cherry_pick(repo_path: &str, commit: &str) -> Result<(), String> {
    let commit = commit.trim();
    if commit.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(commit)?;
    run_git(repo_path, &["cherry-pick", commit]).map(|_| ())
}

/// Reset the current branch to `commit`. `mode` is "soft" or "hard" (default).
pub fn reset(repo_path: &str, commit: &str, mode: Option<&str>) -> Result<(), String> {
    let commit = commit.trim();
    if commit.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(commit)?;
    let flag = if mode == Some("soft") { "--soft" } else { "--hard" };
    run_git(repo_path, &["reset", flag, commit]).map(|_| ())
}

#[tauri::command]
pub fn git_log(repo_path: String, limit: Option<usize>) -> Result<Vec<CommitInfo>, String> {
    log(&repo_path, limit.unwrap_or(50))
}

#[tauri::command]
pub fn git_diff(repo_path: String, staged: bool) -> Result<String, String> {
    diff(&repo_path, staged)
}

#[tauri::command]
pub fn git_push(repo_path: String) -> Result<String, String> {
    push(&repo_path)
}

#[tauri::command]
pub fn git_graph_log(
    repo_path: String,
    limit: Option<usize>,
    skip: Option<usize>,
) -> Result<GraphLog, String> {
    graph_log(&repo_path, limit.unwrap_or(300), skip.unwrap_or(0))
}

#[tauri::command]
pub fn git_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    branches(&repo_path)
}

#[tauri::command]
pub fn git_branch_checkout(repo_path: String, name: String) -> Result<(), String> {
    branch_checkout(&repo_path, &name)
}

#[tauri::command]
pub fn git_branch_create_at(repo_path: String, name: String, commit: String) -> Result<(), String> {
    branch_create_at(&repo_path, &name, &commit)
}

#[tauri::command]
pub fn git_branch_delete(repo_path: String, name: String, force: Option<bool>) -> Result<(), String> {
    branch_delete(&repo_path, &name, force.unwrap_or(false))
}

#[tauri::command]
pub fn git_tag_create(
    repo_path: String,
    name: String,
    commit: String,
    message: Option<String>,
) -> Result<(), String> {
    tag_create(&repo_path, &name, &commit, message.as_deref())
}

#[tauri::command]
pub fn git_tag_delete(repo_path: String, name: String) -> Result<(), String> {
    tag_delete(&repo_path, &name)
}

#[tauri::command]
pub fn git_merge(repo_path: String, name: String) -> Result<(), String> {
    merge(&repo_path, &name)
}

#[tauri::command]
pub fn git_revert(repo_path: String, commit: String) -> Result<(), String> {
    revert(&repo_path, &commit)
}

#[tauri::command]
pub fn git_cherry_pick(repo_path: String, commit: String) -> Result<(), String> {
    cherry_pick(&repo_path, &commit)
}

#[tauri::command]
pub fn git_reset(repo_path: String, commit: String, mode: Option<String>) -> Result<(), String> {
    reset(&repo_path, &commit, mode.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_status_codes() {
        assert_eq!(index_status(Status::INDEX_NEW), Some("A"));
        assert_eq!(index_status(Status::INDEX_MODIFIED), Some("M"));
        assert_eq!(index_status(Status::INDEX_DELETED), Some("D"));
        assert_eq!(index_status(Status::WT_MODIFIED), None);
    }

    #[test]
    fn worktree_status_codes() {
        assert_eq!(worktree_status(Status::WT_NEW), Some("?"));
        assert_eq!(worktree_status(Status::WT_MODIFIED), Some("M"));
        assert_eq!(worktree_status(Status::WT_DELETED), Some("D"));
        assert_eq!(worktree_status(Status::INDEX_NEW), None);
    }

    #[test]
    fn parse_refs_head_branch_tag_remote() {
        let refs = parse_refs(
            " (HEAD -> refs/heads/main, tag: refs/tags/v1.0, refs/remotes/origin/main, refs/heads/feature/x)",
        );
        assert_eq!(refs.len(), 4);
        assert_eq!(refs[0], GraphRef { name: "main".into(), kind: "head".into() });
        assert_eq!(refs[1], GraphRef { name: "v1.0".into(), kind: "tag".into() });
        assert_eq!(refs[2], GraphRef { name: "origin/main".into(), kind: "remote".into() });
        assert_eq!(refs[3], GraphRef { name: "feature/x".into(), kind: "branch".into() });
    }

    #[test]
    fn parse_refs_empty_and_detached() {
        assert!(parse_refs("").is_empty());
        assert!(parse_refs("   ").is_empty());
        let refs = parse_refs(" (HEAD)");
        assert_eq!(refs, vec![GraphRef { name: "HEAD".into(), kind: "head".into() }]);
    }

    #[test]
    fn parse_graph_commit_splits_fields_and_keeps_pipes_in_message() {
        let commit =
            parse_graph_commit("abc123|p1 p2|Ada|2024-01-02 03:04| (HEAD -> refs/heads/main)|fix: a|b")
                .unwrap();
        assert_eq!(commit.hash, "abc123");
        assert_eq!(commit.parents, vec!["p1".to_string(), "p2".to_string()]);
        assert_eq!(commit.author, "Ada");
        assert_eq!(commit.date, "2024-01-02 03:04");
        assert_eq!(commit.refs, vec![GraphRef { name: "main".into(), kind: "head".into() }]);
        // The subject retained its embedded pipe.
        assert_eq!(commit.message, "fix: a|b");
        assert!(parse_graph_commit("   ").is_none());
    }

    #[test]
    fn graph_log_and_branches_on_a_real_repo() {
        let dir = temp_repo_dir("graph");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.name", "Test"]).unwrap();
        run_git(&path, &["config", "user.email", "test@example.com"]).unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();
        run_git(&path, &["commit", "-m", "first"]).unwrap();
        std::fs::write(dir.join("a.txt"), "two\n").unwrap();
        run_git(&path, &["commit", "-am", "second"]).unwrap();

        let log = graph_log(&path, 10, 0).unwrap();
        assert_eq!(log.commits.len(), 2);
        assert!(!log.has_more);
        // Newest first; the HEAD ref decorates the tip.
        assert_eq!(log.commits[0].message, "second");
        assert!(log.commits[0]
            .refs
            .iter()
            .any(|r| r.kind == "head" && r.name == "main"));

        // has_more is true once the page is smaller than the history.
        let page = graph_log(&path, 1, 0).unwrap();
        assert_eq!(page.commits.len(), 1);
        assert!(page.has_more);

        let branches = branches(&path).unwrap();
        assert_eq!(
            branches,
            vec![BranchInfo { name: "main".into(), is_current: true }]
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn branch_and_tag_actions_on_a_real_repo() {
        let dir = temp_repo_dir("actions");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.name", "Test"]).unwrap();
        run_git(&path, &["config", "user.email", "test@example.com"]).unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();
        run_git(&path, &["commit", "-m", "first"]).unwrap();
        let head = run_git(&path, &["rev-parse", "HEAD"]).unwrap().trim().to_string();

        // Create branch at the commit and switch to it.
        branch_create_at(&path, "feature", &head).unwrap();
        assert!(branches(&path).unwrap().iter().any(|b| b.name == "feature" && b.is_current));

        // Tag the commit, then it should decorate the graph node.
        tag_create(&path, "v1", &head, Some("release")).unwrap();
        let log = graph_log(&path, 10, 0).unwrap();
        assert!(log.commits[0].refs.iter().any(|r| r.kind == "tag" && r.name == "v1"));

        // Back to main, then the feature branch can be deleted.
        branch_checkout(&path, "main").unwrap();
        branch_delete(&path, "feature", true).unwrap();
        assert!(!branches(&path).unwrap().iter().any(|b| b.name == "feature"));

        tag_delete(&path, "v1").unwrap();
        let log = graph_log(&path, 10, 0).unwrap();
        assert!(!log.commits[0].refs.iter().any(|r| r.kind == "tag"));

        // Empty-name guards surface as errors instead of running git.
        assert!(branch_checkout(&path, "  ").is_err());
        assert!(tag_create(&path, "x", "  ", None).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn flag_like_arguments_are_rejected_before_running_git() {
        // A ref/commit value beginning with '-' would be smuggled to git as a
        // flag (argv flag smuggling). The guard must reject it *before* any git
        // call, so the error comes from us, not from git tripping over an
        // unknown switch. We assert the guard's wording to prove it fired.
        let err = branch_checkout("/no/such/repo", "--upload-pack=evil").unwrap_err();
        assert!(err.to_lowercase().contains("flag"), "got: {err}");

        let err = revert("/no/such/repo", "-x").unwrap_err();
        assert!(err.to_lowercase().contains("flag"), "got: {err}");

        // Legitimate names/hashes pass; only a leading dash is rejected.
        assert!(ensure_not_flag("main").is_ok());
        assert!(ensure_not_flag("feature/x").is_ok());
        assert!(ensure_not_flag("v1.0").is_ok());
        assert!(ensure_not_flag("a1b2c3d").is_ok());
        assert!(ensure_not_flag("-x").is_err());
        assert!(ensure_not_flag("--upload-pack=evil").is_err());
    }

    fn temp_repo_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tempoterm-git-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn full_stage_and_commit_flow_on_a_real_repo() {
        let dir = temp_repo_dir("flow");
        let path = dir.to_string_lossy().to_string();
        let repo = Repository::init(&dir).unwrap();
        // libgit2 needs a signature; set a local config for the test repo.
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@example.com").unwrap();

        std::fs::write(dir.join("hello.txt"), "hi 你好").unwrap();

        // New file shows up as untracked (unstaged).
        let before = status(&path).unwrap();
        assert!(before
            .unstaged
            .iter()
            .any(|f| f.path == "hello.txt" && f.status == "?"));

        // Stage it -> appears as added in the index.
        stage(&path, "hello.txt").unwrap();
        let staged = status(&path).unwrap();
        assert!(staged
            .staged
            .iter()
            .any(|f| f.path == "hello.txt" && f.status == "A"));

        // Commit -> working tree becomes clean and the log has one entry.
        let id = commit(&path, "first commit").unwrap();
        assert!(!id.is_empty());
        let after = status(&path).unwrap();
        assert!(after.staged.is_empty() && after.unstaged.is_empty());
        let history = log(&path, 10).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].summary, "first commit");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_repo_finds_the_workdir() {
        let dir = temp_repo_dir("resolve");
        Repository::init(&dir).unwrap();
        let sub = dir.join("nested");
        std::fs::create_dir_all(&sub).unwrap();
        let resolved = resolve_repo(&sub.to_string_lossy()).unwrap();
        // Resolved root should be the repo dir (allowing for /private symlink on macOS).
        assert!(resolved.ends_with(dir.file_name().unwrap().to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn diff_shows_staged_changes() {
        let dir = temp_repo_dir("diff");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init"]).unwrap();
        run_git(&path, &["config", "user.name", "Test"]).unwrap();
        run_git(&path, &["config", "user.email", "test@example.com"]).unwrap();
        std::fs::write(dir.join("a.txt"), "hello world\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();

        let staged_diff = diff(&path, true).unwrap();
        assert!(staged_diff.contains("a.txt"));
        assert!(staged_diff.contains("+hello world"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
