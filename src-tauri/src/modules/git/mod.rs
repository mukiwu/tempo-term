//! Git integration backed by libgit2 (git2 crate): status, staging and commit.

use std::path::Path;

use git2::{Repository, Signature, Status, StatusOptions};
use serde::{Deserialize, Serialize};

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

/// 分支清單的一筆，本地或遠端。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BranchInfo {
    pub name: String,
    #[serde(rename = "isCurrent")]
    pub is_current: bool,
    #[serde(rename = "isRemote")]
    pub is_remote: bool,
}

/// 一個 commit 變更的單一檔案。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommitFileChange {
    pub status: String,
    pub path: String,
}

/// 一個 commit 的詳情：完整訊息與變更檔案清單。
#[derive(Debug, Clone, Serialize)]
pub struct CommitDetails {
    pub message: String,
    pub files: Vec<CommitFileChange>,
}

/// 線圖的顯示選項，來自前端工具列。branch 空字串或 None 代表 Show All。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GraphOptions {
    pub branch: Option<String>,
    pub include_remotes: bool,
    pub include_tags: bool,
    pub include_stashes: bool,
}

/// 把顯示選項翻成 git log 的 ref 範圍參數。純函式方便測試。
/// 指定分支時只給該分支，沒指定用 --branches 含全部本地分支；
/// remote/tag/stash 開關各自疊加。
fn build_log_refs(options: &GraphOptions) -> Vec<String> {
    let mut refs: Vec<String> = Vec::new();
    let branch = options
        .branch
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty());
    match branch {
        Some(name) => refs.push(name.to_string()),
        None => refs.push("--branches".to_string()),
    }
    if options.include_remotes {
        refs.push("--remotes".to_string());
    }
    if options.include_tags {
        refs.push("--tags".to_string());
    }
    if options.include_stashes {
        refs.push("--glob=refs/stash".to_string());
    }
    refs
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

/// 抓所有遠端並清掉已刪除的遠端分支。
pub fn fetch(repo_path: &str) -> Result<(), String> {
    run_git(repo_path, &["fetch", "--all", "--prune"]).map(|_| ())
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
            if token == "refs/stash" {
                return Some(GraphRef {
                    name: "stash".to_string(),
                    kind: "stash".to_string(),
                });
            }
            if let Some(rest) = token.strip_prefix("refs/tags/") {
                return Some(GraphRef {
                    name: rest.to_string(),
                    kind: "tag".to_string(),
                });
            }
            // Unknown namespace (refs/notes, ...) — not a deletable branch/tag.
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

/// 解析一行 `git diff --name-status` 輸出成 CommitFileChange。
/// 純函式方便測試。改名/複製(R100、C95)取最後一欄(新路徑)，狀態取首字母。
fn parse_name_status_line(line: &str) -> Option<CommitFileChange> {
    if line.trim().is_empty() {
        return None;
    }
    let mut parts = line.trim_end().split('\t');
    let status_raw = parts.next()?.trim();
    let status = status_raw.chars().next()?.to_string();
    // 一般狀態 "M\tpath" 的 path 是最後一欄；改名 "R100\told\tnew" 的新路徑也是最後一欄。
    let path = parts.last()?.trim().to_string();
    if path.is_empty() {
        return None;
    }
    Some(CommitFileChange { status, path })
}

/// 讀取線圖的 commit DAG。`limit` 限制回傳數量，內部多抓一筆算 `has_more`。
/// `options` 決定要畫哪些分支、要不要含遠端/標籤/stash。
pub fn graph_log(
    repo_path: &str,
    limit: usize,
    skip: usize,
    options: &GraphOptions,
) -> Result<GraphLog, String> {
    let limit = limit.clamp(1, 2000);
    let max_count = format!("--max-count={}", limit + 1);
    let skip_arg = format!("--skip={skip}");

    // 指定分支會當成位置參數傳給 git，先擋掉開頭是 - 的值。
    if let Some(branch) = options
        .branch
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
    {
        ensure_not_flag(branch)?;
    }

    let ref_args = build_log_refs(options);
    let mut args: Vec<&str> = vec![
        "log",
        "--topo-order",
        "--decorate=full",
        "--pretty=format:%h|%p|%an|%ad|%d|%s",
        "--date=format-local:%Y-%m-%d %H:%M",
        &max_count,
        &skip_arg,
    ];
    args.extend(ref_args.iter().map(String::as_str));

    // 空 repo（還沒任何 commit）會讓 git log 非零退出，當成空線圖。
    let stdout = run_git(repo_path, &args).unwrap_or_default();

    let mut commits: Vec<GraphCommit> = stdout.lines().filter_map(parse_graph_commit).collect();
    let has_more = commits.len() > limit;
    if has_more {
        commits.truncate(limit);
    }
    Ok(GraphLog { commits, has_more })
}

/// 列出本地與遠端分支，標出目前所在分支與是否為遠端。
pub fn branches(repo_path: &str) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.message().to_string())?;
    let head_name = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let mut out = Vec::new();

    let local = repo
        .branches(Some(git2::BranchType::Local))
        .map_err(|e| e.message().to_string())?;
    for entry in local {
        let (branch, _) = entry.map_err(|e| e.message().to_string())?;
        if let Some(name) = branch.name().map_err(|e| e.message().to_string())? {
            let name = name.to_string();
            let is_current = Some(&name) == head_name.as_ref();
            out.push(BranchInfo {
                name,
                is_current,
                is_remote: false,
            });
        }
    }

    let remote = repo
        .branches(Some(git2::BranchType::Remote))
        .map_err(|e| e.message().to_string())?;
    for entry in remote {
        let (branch, _) = entry.map_err(|e| e.message().to_string())?;
        if let Some(name) = branch.name().map_err(|e| e.message().to_string())? {
            // 跳過 origin/HEAD 這種 symbolic ref，它只是指向預設分支。
            if name.ends_with("/HEAD") {
                continue;
            }
            out.push(BranchInfo {
                name: name.to_string(),
                is_current: false,
                is_remote: true,
            });
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

/// Rebase the current branch onto `commit`.
pub fn rebase(repo_path: &str, commit: &str) -> Result<(), String> {
    let commit = commit.trim();
    if commit.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(commit)?;
    run_git(repo_path, &["rebase", commit]).map(|_| ())
}

/// Create a local branch `local` tracking `remote_ref` (e.g. "origin/feat/x")
/// and switch to it. Checking out a remote ref directly would detach HEAD, so a
/// tracking branch is created instead.
pub fn branch_checkout_track(
    repo_path: &str,
    local: &str,
    remote_ref: &str,
) -> Result<(), String> {
    let local = local.trim();
    let remote_ref = remote_ref.trim();
    if local.is_empty() {
        return Err("branch name is required".to_string());
    }
    if remote_ref.is_empty() {
        return Err("remote ref is required".to_string());
    }
    ensure_not_flag(local)?;
    ensure_not_flag(remote_ref)?;
    run_git(repo_path, &["checkout", "-b", local, "--track", remote_ref]).map(|_| ())
}

/// Pull `branch` from `remote` into the current branch (fetch + merge).
pub fn pull(repo_path: &str, remote: &str, branch: &str) -> Result<(), String> {
    let remote = remote.trim();
    let branch = branch.trim();
    if remote.is_empty() {
        return Err("remote is required".to_string());
    }
    if branch.is_empty() {
        return Err("branch is required".to_string());
    }
    ensure_not_flag(remote)?;
    ensure_not_flag(branch)?;
    run_git(repo_path, &["pull", remote, branch]).map(|_| ())
}

/// Delete `branch` on `remote` (git push <remote> --delete <branch>).
pub fn push_delete(repo_path: &str, remote: &str, branch: &str) -> Result<(), String> {
    let remote = remote.trim();
    let branch = branch.trim();
    if remote.is_empty() {
        return Err("remote is required".to_string());
    }
    if branch.is_empty() {
        return Err("branch is required".to_string());
    }
    ensure_not_flag(remote)?;
    ensure_not_flag(branch)?;
    run_git(repo_path, &["push", remote, "--delete", branch]).map(|_| ())
}

/// 一個 commit 的完整訊息與變更檔案。檔案清單對第一個 parent 取差異，
/// 一般 commit 等同 `git show`，merge 顯示相對主線帶進來的變更。
/// root commit(無 parent)退回 `--root` 模式。
pub fn commit_details(repo_path: &str, commit: &str) -> Result<CommitDetails, String> {
    let commit = commit.trim();
    if commit.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(commit)?;

    let message = run_git(repo_path, &["show", "-s", "--format=%B", commit])?
        .trim_end()
        .to_string();

    let parent = format!("{commit}^1");
    let name_status = run_git(repo_path, &["diff", "--name-status", &parent, commit])
        .or_else(|_| {
            // root commit 沒有 parent，整個 commit 當成新增。
            run_git(
                repo_path,
                &["show", "--name-status", "--format=", "--root", commit],
            )
        })
        .unwrap_or_default();

    let files = name_status
        .lines()
        .filter_map(parse_name_status_line)
        .collect();

    Ok(CommitDetails { message, files })
}

/// 單一檔案在某 commit 的 diff(對第一個 parent)。回原始 unified diff 字串。
pub fn commit_file_diff(repo_path: &str, commit: &str, file: &str) -> Result<String, String> {
    let commit = commit.trim();
    if commit.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(commit)?;

    let parent = format!("{commit}^1");
    let diff = run_git(repo_path, &["diff", &parent, commit, "--", file])
        .or_else(|_| run_git(repo_path, &["show", "--root", "--format=", commit, "--", file]))
        .unwrap_or_default();
    Ok(diff)
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
pub fn git_fetch(repo_path: String) -> Result<(), String> {
    fetch(&repo_path)
}

#[tauri::command]
pub fn git_graph_log(
    repo_path: String,
    limit: Option<usize>,
    skip: Option<usize>,
    options: Option<GraphOptions>,
) -> Result<GraphLog, String> {
    graph_log(
        &repo_path,
        limit.unwrap_or(300),
        skip.unwrap_or(0),
        &options.unwrap_or_default(),
    )
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

#[tauri::command]
pub fn git_rebase(repo_path: String, commit: String) -> Result<(), String> {
    rebase(&repo_path, &commit)
}

#[tauri::command]
pub fn git_branch_checkout_track(
    repo_path: String,
    local: String,
    remote_ref: String,
) -> Result<(), String> {
    branch_checkout_track(&repo_path, &local, &remote_ref)
}

#[tauri::command]
pub fn git_pull(repo_path: String, remote: String, branch: String) -> Result<(), String> {
    pull(&repo_path, &remote, &branch)
}

#[tauri::command]
pub fn git_push_delete(repo_path: String, remote: String, branch: String) -> Result<(), String> {
    push_delete(&repo_path, &remote, &branch)
}

#[tauri::command]
pub fn git_commit_details(repo_path: String, commit: String) -> Result<CommitDetails, String> {
    commit_details(&repo_path, &commit)
}

#[tauri::command]
pub fn git_commit_file_diff(
    repo_path: String,
    commit: String,
    file: String,
) -> Result<String, String> {
    commit_file_diff(&repo_path, &commit, &file)
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
    fn parse_refs_stash() {
        let refs = parse_refs(" (refs/stash)");
        assert_eq!(
            refs,
            vec![GraphRef {
                name: "stash".to_string(),
                kind: "stash".to_string(),
            }]
        );
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

        let log = graph_log(&path, 10, 0, &GraphOptions::default()).unwrap();
        assert_eq!(log.commits.len(), 2);
        assert!(!log.has_more);
        // Newest first; the HEAD ref decorates the tip.
        assert_eq!(log.commits[0].message, "second");
        assert!(log.commits[0]
            .refs
            .iter()
            .any(|r| r.kind == "head" && r.name == "main"));

        // has_more is true once the page is smaller than the history.
        let page = graph_log(&path, 1, 0, &GraphOptions::default()).unwrap();
        assert_eq!(page.commits.len(), 1);
        assert!(page.has_more);

        let branches = branches(&path).unwrap();
        assert_eq!(
            branches,
            vec![BranchInfo { name: "main".into(), is_current: true, is_remote: false }]
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
        assert!(branches(&path).unwrap().iter().any(|b| b.name == "feature" && b.is_current && !b.is_remote));

        // Tag the commit, then it should decorate the graph node.
        tag_create(&path, "v1", &head, Some("release")).unwrap();
        let log = graph_log(&path, 10, 0, &GraphOptions::default()).unwrap();
        assert!(log.commits[0].refs.iter().any(|r| r.kind == "tag" && r.name == "v1"));

        // Back to main, then the feature branch can be deleted.
        branch_checkout(&path, "main").unwrap();
        branch_delete(&path, "feature", true).unwrap();
        assert!(!branches(&path).unwrap().iter().any(|b| b.name == "feature"));

        tag_delete(&path, "v1").unwrap();
        let log = graph_log(&path, 10, 0, &GraphOptions::default()).unwrap();
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

    #[test]
    fn remote_branch_actions_with_a_local_bare_remote() {
        // A bare repo on disk stands in for a real remote so push/pull/delete
        // run fully offline.
        let bare = temp_repo_dir("remote-bare");
        let bare_path = bare.to_string_lossy().to_string();
        run_git(&bare_path, &["init", "--bare", "-b", "main"]).unwrap();

        let work = temp_repo_dir("remote-work");
        let path = work.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.name", "Test"]).unwrap();
        run_git(&path, &["config", "user.email", "test@example.com"]).unwrap();
        std::fs::write(work.join("a.txt"), "one\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();
        run_git(&path, &["commit", "-m", "first"]).unwrap();
        run_git(&path, &["remote", "add", "origin", &bare_path]).unwrap();
        run_git(&path, &["push", "-u", "origin", "main"]).unwrap();

        // A second branch pushed to the remote, then fetched so origin/feature
        // shows up as a remote-tracking ref.
        run_git(&path, &["checkout", "-b", "feature"]).unwrap();
        std::fs::write(work.join("a.txt"), "two\n").unwrap();
        run_git(&path, &["commit", "-am", "second"]).unwrap();
        run_git(&path, &["push", "origin", "feature"]).unwrap();
        run_git(&path, &["checkout", "main"]).unwrap();
        run_git(&path, &["fetch", "origin"]).unwrap();

        // Checkout the remote branch as a local tracking branch.
        branch_checkout_track(&path, "feature-local", "origin/feature").unwrap();
        assert!(branches(&path)
            .unwrap()
            .iter()
            .any(|b| b.name == "feature-local" && b.is_current && !b.is_remote));

        // Pull main from the remote (already up to date) succeeds.
        run_git(&path, &["checkout", "main"]).unwrap();
        pull(&path, "origin", "main").unwrap();

        // Rebasing onto an ancestor (HEAD) is a no-op that still succeeds.
        rebase(&path, "HEAD").unwrap();

        // Delete the feature branch on the remote; it disappears from ls-remote.
        push_delete(&path, "origin", "feature").unwrap();
        let remote_heads = run_git(&path, &["ls-remote", "--heads", "origin"]).unwrap();
        assert!(!remote_heads.contains("refs/heads/feature"));
        assert!(remote_heads.contains("refs/heads/main"));

        // Empty-arg guards surface as errors instead of running git.
        assert!(branch_checkout_track(&path, "  ", "origin/feature").is_err());
        assert!(pull(&path, "origin", "  ").is_err());
        assert!(push_delete(&path, "  ", "feature").is_err());
        assert!(rebase(&path, "  ").is_err());

        let _ = std::fs::remove_dir_all(&work);
        let _ = std::fs::remove_dir_all(&bare);
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

    #[test]
    fn build_log_refs_show_all_default() {
        let options = GraphOptions::default();
        assert_eq!(build_log_refs(&options), vec!["--branches".to_string()]);
    }

    #[test]
    fn build_log_refs_specific_branch() {
        let options = GraphOptions {
            branch: Some("main".to_string()),
            ..GraphOptions::default()
        };
        assert_eq!(build_log_refs(&options), vec!["main".to_string()]);
    }

    #[test]
    fn build_log_refs_toggles_stack() {
        let options = GraphOptions {
            branch: None,
            include_remotes: true,
            include_tags: true,
            include_stashes: true,
        };
        assert_eq!(
            build_log_refs(&options),
            vec![
                "--branches".to_string(),
                "--remotes".to_string(),
                "--tags".to_string(),
                "--glob=refs/stash".to_string(),
            ]
        );
    }

    #[test]
    fn build_log_refs_blank_branch_is_show_all() {
        let options = GraphOptions {
            branch: Some("   ".to_string()),
            ..GraphOptions::default()
        };
        assert_eq!(build_log_refs(&options), vec!["--branches".to_string()]);
    }

    #[test]
    fn parse_name_status_modified() {
        assert_eq!(
            parse_name_status_line("M\tsrc/main.rs"),
            Some(CommitFileChange { status: "M".into(), path: "src/main.rs".into() })
        );
    }

    #[test]
    fn parse_name_status_added_and_deleted() {
        assert_eq!(
            parse_name_status_line("A\tnew.txt"),
            Some(CommitFileChange { status: "A".into(), path: "new.txt".into() })
        );
        assert_eq!(
            parse_name_status_line("D\told.txt"),
            Some(CommitFileChange { status: "D".into(), path: "old.txt".into() })
        );
    }

    #[test]
    fn parse_name_status_rename_takes_new_path() {
        assert_eq!(
            parse_name_status_line("R100\told/a.rs\tnew/b.rs"),
            Some(CommitFileChange { status: "R".into(), path: "new/b.rs".into() })
        );
    }

    #[test]
    fn parse_name_status_blank_is_none() {
        assert_eq!(parse_name_status_line(""), None);
        assert_eq!(parse_name_status_line("   "), None);
    }
}
