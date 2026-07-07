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
    /// Parent commit hashes, abbreviated to match `id`. Lets the frontend lay
    /// out a compact commit graph without a second round-trip.
    pub parents: Vec<String>,
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
/// 線圖 commit 的排序方式。`Date` 依時間交錯（VSCode 預設，分支線並排展開），
/// `Topo` 依拓樸把同一分支的 commit 收攏（線較少）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CommitOrder {
    #[default]
    Date,
    Topo,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GraphOptions {
    pub branch: Option<String>,
    pub include_remotes: bool,
    pub include_tags: bool,
    pub include_stashes: bool,
    pub order: CommitOrder,
}

/// 把排序選項翻成 git log 旗標。純函式方便測試。
fn order_flag(order: CommitOrder) -> &'static str {
    match order {
        CommitOrder::Date => "--date-order",
        CommitOrder::Topo => "--topo-order",
    }
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

/// Branch and worktree context for a directory's repository. For a linked
/// worktree, `main_branch`/`main_path` describe the primary working tree so the
/// UI can show both the main repo and the worktree on a card.
#[derive(Debug, Clone, Serialize)]
pub struct WorktreeInfo {
    pub branch: Option<String>,
    pub cwd: String,
    #[serde(rename = "isWorktree")]
    pub is_worktree: bool,
    #[serde(rename = "mainBranch")]
    pub main_branch: Option<String>,
    #[serde(rename = "mainPath")]
    pub main_path: Option<String>,
}

/// The current branch shorthand (e.g. "main"). Falls back to HEAD's symbolic
/// target so a fresh repo with no commits (an unborn branch) still reports its
/// name; None only on a truly detached HEAD.
fn head_shorthand(repo: &Repository) -> Option<String> {
    repo.head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .or_else(|| {
            repo.find_reference("HEAD")
                .ok()
                .and_then(|r| r.symbolic_target().map(str::to_string))
                .map(|t| t.strip_prefix("refs/heads/").unwrap_or(&t).to_string())
        })
}

/// A workdir path as a clean string, without a trailing slash.
fn workdir_string(p: &Path) -> String {
    p.to_string_lossy().trim_end_matches('/').to_string()
}

pub fn worktree_info(path: &str) -> Result<WorktreeInfo, String> {
    let repo = Repository::discover(path).map_err(|e| e.message().to_string())?;
    let branch = head_shorthand(&repo);
    let cwd = repo
        .workdir()
        .map(workdir_string)
        .unwrap_or_else(|| path.to_string());

    if !repo.is_worktree() {
        return Ok(WorktreeInfo {
            branch,
            cwd,
            is_worktree: false,
            main_branch: None,
            main_path: None,
        });
    }

    // A linked worktree's git dir is <main>/.git/worktrees/<name>; the ".git"
    // ancestor's parent is the main working tree. Open it to read the main branch.
    let (main_branch, main_path) = repo
        .path()
        .ancestors()
        .find(|a| a.file_name().and_then(|n| n.to_str()) == Some(".git"))
        .and_then(|git_dir| git_dir.parent())
        .and_then(|parent| Repository::open(parent).ok())
        .map(|main_repo| {
            let branch = head_shorthand(&main_repo);
            let path = main_repo.workdir().map(workdir_string);
            (branch, path)
        })
        .unwrap_or((None, None));

    Ok(WorktreeInfo {
        branch,
        cwd,
        is_worktree: true,
        main_branch,
        main_path,
    })
}

/// One entry of `git worktree list`: the worktree's absolute path and its
/// checked-out branch (None on a detached HEAD). Bare entries are skipped.
#[derive(Debug, Clone, Serialize)]
pub struct WorktreeListItem {
    pub path: String,
    pub branch: Option<String>,
}

/// Lists every worktree of the repository via `git worktree list --porcelain`:
/// blank-line-separated blocks of `worktree <path>`, `HEAD <sha>`, then
/// `branch refs/heads/<name>` or `detached`. A `bare` block has no working
/// tree to switch to and a `prunable` one no longer exists on disk, so both
/// are dropped — offering either as a switch target would strand the app's
/// workspace root somewhere unusable.
pub fn worktree_list(repo_path: &str) -> Result<Vec<WorktreeListItem>, String> {
    let stdout = run_git(repo_path, &["worktree", "list", "--porcelain"])?;
    let mut items = Vec::new();
    let mut path: Option<String> = None;
    let mut branch: Option<String> = None;
    let mut skip = false;

    for line in stdout.lines().chain(std::iter::once("")) {
        if line.is_empty() {
            if let Some(p) = path.take() {
                if !skip {
                    items.push(WorktreeListItem {
                        path: p,
                        branch: branch.take(),
                    });
                }
            }
            branch = None;
            skip = false;
        } else if let Some(rest) = line.strip_prefix("worktree ") {
            path = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("branch ") {
            branch = Some(rest.strip_prefix("refs/heads/").unwrap_or(rest).to_string());
        } else if line == "bare" || line == "prunable" || line.starts_with("prunable ") {
            skip = true;
        }
        // `HEAD <sha>` and `detached` lines are ignored: branch simply stays
        // None for a detached worktree.
    }
    Ok(items)
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

/// Parses one `git log --pretty=format:%h%x1f%p%x1f%an%x1f%ct%x1f%s` line.
/// `%x1f` (ASCII unit separator) is the field delimiter rather than a
/// printable character like "|": author names and commit summaries are free
/// text that could in principle contain any printable character, and a
/// delimiter byte that never appears in normal text means no field can ever
/// be mistaken for another, regardless of its position in the line.
/// `splitn(5, ..)` bounds the split to the 5 known fields, so a delimiter-like
/// byte inside the final field (the summary) is naturally preserved without
/// an extra rejoin. `%p` is empty (not absent) for a root commit, which
/// `split_whitespace` already collapses to an empty Vec.
fn parse_commit_info(line: &str) -> Option<CommitInfo> {
    if line.trim().is_empty() {
        return None;
    }
    let parts: Vec<&str> = line.splitn(5, '\x1f').collect();
    if parts.len() < 5 {
        return None;
    }
    let timestamp: i64 = parts[3].trim().parse().unwrap_or(0);
    Some(CommitInfo {
        id: parts[0].trim().to_string(),
        parents: parts[1].split_whitespace().map(String::from).collect(),
        author: parts[2].trim().to_string(),
        timestamp,
        summary: parts[4].trim().to_string(),
    })
}

pub fn log(repo_path: &str, limit: usize) -> Result<Vec<CommitInfo>, String> {
    let limit = limit.max(1);
    let max_count = format!("--max-count={limit}");
    // Shell out to the system `git` binary (same approach as `graph_log`
    // below) instead of a libgit2 revwalk: `--max-count` keeps this genuinely
    // bounded by `limit` regardless of total repo history. A libgit2 revwalk
    // with an explicit sort mode (needed for correct child-before-parent
    // ordering) forces an eager traversal of the *entire* reachable history
    // before it can yield the first result, which made this O(repo size)
    // instead of O(limit) on large repos.
    let stdout = run_git(
        repo_path,
        &[
            "log",
            "--date-order",
            "--pretty=format:%h%x1f%p%x1f%an%x1f%ct%x1f%s",
            &max_count,
        ],
    )
    // An empty/unborn repo makes `git log` exit non-zero; treat that as no history.
    .unwrap_or_default();

    Ok(stdout.lines().filter_map(parse_commit_info).collect())
}

/// Commits authored in `[since_ms, until_ms]` (epoch MILLISECONDS) in the git
/// work tree at `cwd`. Empty for an empty/remote (`://`) `cwd`, a non-git dir,
/// or any git failure — a missing/odd repo simply shows no commits, never an
/// error. Session↔code correlation for the transcript viewer.
fn git_commits_in_range_impl(cwd: &str, since_ms: i64, until_ms: i64) -> Vec<CommitInfo> {
    if cwd.is_empty() || cwd.contains("://") || ensure_not_flag(cwd).is_err() {
        return Vec::new();
    }
    // Must be a git work tree.
    match run_git(cwd, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(out) if out.trim() == "true" => {}
        _ => return Vec::new(),
    }
    // git wants seconds; sessions carry milliseconds. `@<seconds> +0000` is
    // the same absolute-epoch form git itself writes for GIT_AUTHOR_DATE — a
    // bare number is parsed by approxidate as a relative offset, not an
    // epoch timestamp, so the "@" + explicit offset is required here.
    let since = since_ms / 1000;
    let until = until_ms / 1000;
    let args = [
        "log",
        "--date-order",
        &format!("--since=@{since} +0000"),
        &format!("--until=@{until} +0000"),
        "--pretty=format:%h%x1f%p%x1f%an%x1f%ct%x1f%s",
        "--max-count=100",
    ];
    match run_git(cwd, &args) {
        Ok(out) => out.lines().filter_map(parse_commit_info).collect(),
        Err(_) => Vec::new(),
    }
}

/// Commits authored in `[since_ms, until_ms]` (epoch milliseconds) in the git
/// work tree at `cwd`, for correlating a viewed session with the commits made
/// during it. Always `Ok`; a non-git/remote cwd or any git failure yields an
/// empty list rather than an error.
#[tauri::command]
pub fn git_commits_in_range(
    cwd: String,
    since_ms: i64,
    until_ms: i64,
) -> Result<Vec<CommitInfo>, String> {
    Ok(git_commits_in_range_impl(&cwd, since_ms, until_ms))
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
pub async fn git_worktree_info(path: String) -> Result<WorktreeInfo, String> {
    // Spawns a git subprocess per call; run it off the main thread so a slow repo
    // (or several at once when the workspace panel mounts) never freezes the UI.
    tauri::async_runtime::spawn_blocking(move || worktree_info(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_worktree_list(path: String) -> Result<Vec<WorktreeListItem>, String> {
    // Spawns a git subprocess; run it off the main thread so a slow repo never
    // freezes the UI (same rationale as git_worktree_info above).
    tauri::async_runtime::spawn_blocking(move || worktree_list(&path))
        .await
        .map_err(|e| e.to_string())?
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
    let mut command = std::process::Command::new("git");
    command.arg("-C").arg(repo_path).args(args);
    // A release build runs without a console (windows_subsystem = "windows" in
    // main.rs), so without this flag Windows allocates a fresh console for every
    // spawned git process — each one flashes a window and adds ~100ms. That is
    // felt as lag every time a commit or file diff is opened (one spawn per
    // click). CREATE_NO_WINDOW suppresses the console; a no-op on a debug build
    // that already owns one, which is why `tauri dev` never shows the slowdown.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().map_err(|e| e.to_string())?;
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

/// Content of `path` at `rev`, where rev is limited to "HEAD" (last commit)
/// or ":" (the index) — the only two versions the diff tab compares against.
/// A file missing at that rev is an empty document, not an error, so new
/// files diff as all-added.
pub fn file_at_rev(repo_path: &str, rev: &str, path: &str) -> Result<String, String> {
    if rev != "HEAD" && rev != ":" {
        return Err(format!("unsupported rev: {rev}"));
    }
    ensure_not_flag(path)?;
    // "HEAD:path" names the committed version; ":path" (single colon) names
    // the index version — the colon separator is already part of that rev.
    let spec = if rev == ":" {
        format!(":{path}")
    } else {
        format!("{rev}:{path}")
    };
    match run_git(repo_path, &["show", &spec]) {
        Ok(content) => Ok(content),
        // `git show` wording varies by rev kind and version; match the known
        // "no such file at that rev" messages so a genuine failure (corrupt
        // object, bad repo) still surfaces instead of reading as empty.
        // "invalid object name 'HEAD'" is the unborn-HEAD case (fresh repo,
        // nothing committed yet): every file is new, so HEAD-side is empty.
        Err(err)
            if err.contains("does not exist")
                || err.contains("exists on disk, but not in")
                || err.contains("is in the index, but not at stage")
                || err.contains("invalid object name 'HEAD'") =>
        {
            Ok(String::new())
        }
        Err(err) => Err(err),
    }
}

/// Discard unstaged changes to one tracked file (`git restore`). The pathspec
/// is wrapped in `:(literal)` so git magic like `:/` or `:(glob)` in a crafted
/// path cannot widen the restore beyond the named file.
pub fn restore_file(repo_path: &str, path: &str) -> Result<(), String> {
    ensure_not_flag(path)?;
    run_git(repo_path, &["restore", "--", &format!(":(literal){path}")]).map(|_| ())
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
        order_flag(options.order),
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

/// 兩個任意 commit 之間變更的檔案清單(`git diff --name-status from to`)。
/// 不像 commit_details 限定「對第一個 parent」，from/to 可以是歷史上任意兩點。
pub fn commit_range_files(
    repo_path: &str,
    from: &str,
    to: &str,
) -> Result<Vec<CommitFileChange>, String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() || to.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(from)?;
    ensure_not_flag(to)?;

    let name_status = run_git(repo_path, &["diff", "--name-status", from, to])?;
    let files = name_status
        .lines()
        .filter_map(parse_name_status_line)
        .collect();
    Ok(files)
}

/// 兩個任意 commit 之間、單一檔案的 diff(`git diff from to -- file`)。
pub fn commit_range_file_diff(
    repo_path: &str,
    from: &str,
    to: &str,
    file: &str,
) -> Result<String, String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() || to.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(from)?;
    ensure_not_flag(to)?;

    run_git(repo_path, &["diff", from, to, "--", file])
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
pub fn git_file_at_rev(repo_path: String, rev: String, path: String) -> Result<String, String> {
    file_at_rev(&repo_path, &rev, &path)
}

#[tauri::command]
pub fn git_restore_file(repo_path: String, path: String) -> Result<(), String> {
    restore_file(&repo_path, &path)
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

#[tauri::command]
pub fn git_commit_range_files(
    repo_path: String,
    from: String,
    to: String,
) -> Result<Vec<CommitFileChange>, String> {
    commit_range_files(&repo_path, &from, &to)
}

#[tauri::command]
pub fn git_commit_range_file_diff(
    repo_path: String,
    from: String,
    to: String,
    file: String,
) -> Result<String, String> {
    commit_range_file_diff(&repo_path, &from, &to, &file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worktree_info_reports_branch_for_a_plain_repo() {
        let dir = temp_repo_dir("wt-plain");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(dir.join("a.txt"), "hi").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "init"]).unwrap();

        let info = worktree_info(&path).unwrap();
        assert_eq!(info.branch.as_deref(), Some("main"));
        assert!(!info.is_worktree);
        assert!(info.main_branch.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn worktree_info_reports_the_unborn_branch_before_any_commit() {
        let dir = temp_repo_dir("wt-unborn");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();

        // No commit yet: HEAD is unborn, but the branch name should still show.
        let info = worktree_info(&path).unwrap();
        assert_eq!(info.branch.as_deref(), Some("main"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn worktree_info_reports_main_and_worktree_branches() {
        let root = temp_repo_dir("wt-linked");
        let main = root.join("main");
        std::fs::create_dir_all(&main).unwrap();
        let main_path = main.to_string_lossy().to_string();
        run_git(&main_path, &["init", "-b", "main"]).unwrap();
        run_git(&main_path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&main_path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(main.join("a.txt"), "hi").unwrap();
        run_git(&main_path, &["add", "."]).unwrap();
        run_git(&main_path, &["commit", "-m", "init"]).unwrap();
        let wt = root.join("wt");
        let wt_path = wt.to_string_lossy().to_string();
        run_git(&main_path, &["worktree", "add", &wt_path, "-b", "feature"]).unwrap();

        let info = worktree_info(&wt_path).unwrap();
        assert!(info.is_worktree);
        assert_eq!(info.branch.as_deref(), Some("feature"));
        assert_eq!(info.main_branch.as_deref(), Some("main"));
        assert!(info.main_path.is_some());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_info_errors_outside_a_repo() {
        let dir = temp_repo_dir("wt-norepo");
        assert!(worktree_info(&dir.to_string_lossy()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn worktree_list_reports_main_and_linked_worktrees() {
        let root = temp_repo_dir("wtl-linked");
        let main = root.join("main");
        std::fs::create_dir_all(&main).unwrap();
        let main_path = main.to_string_lossy().to_string();
        run_git(&main_path, &["init", "-b", "main"]).unwrap();
        run_git(&main_path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&main_path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(main.join("a.txt"), "hi").unwrap();
        run_git(&main_path, &["add", "."]).unwrap();
        run_git(&main_path, &["commit", "-m", "init"]).unwrap();
        let wt = root.join("wt");
        let wt_path = wt.to_string_lossy().to_string();
        run_git(&main_path, &["worktree", "add", &wt_path, "-b", "feature"]).unwrap();

        let items = worktree_list(&main_path).unwrap();
        assert_eq!(items.len(), 2);
        // git prints canonicalized absolute paths (e.g. /private/var vs /var on
        // macOS temp dirs), so assert on the unambiguous path suffix.
        assert!(items[0].path.ends_with("/main"));
        assert_eq!(items[0].branch.as_deref(), Some("main"));
        assert!(items[1].path.ends_with("/wt"));
        assert_eq!(items[1].branch.as_deref(), Some("feature"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_list_reports_detached_worktree_without_branch() {
        let root = temp_repo_dir("wtl-detached");
        let main = root.join("main");
        std::fs::create_dir_all(&main).unwrap();
        let main_path = main.to_string_lossy().to_string();
        run_git(&main_path, &["init", "-b", "main"]).unwrap();
        run_git(&main_path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&main_path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(main.join("a.txt"), "hi").unwrap();
        run_git(&main_path, &["add", "."]).unwrap();
        run_git(&main_path, &["commit", "-m", "init"]).unwrap();
        let wt = root.join("wt");
        let wt_path = wt.to_string_lossy().to_string();
        run_git(&main_path, &["worktree", "add", "--detach", &wt_path]).unwrap();

        let items = worktree_list(&main_path).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].branch, None);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_list_skips_prunable_worktrees_whose_directory_is_gone() {
        let root = temp_repo_dir("wtl-prunable");
        let main = root.join("main");
        std::fs::create_dir_all(&main).unwrap();
        let main_path = main.to_string_lossy().to_string();
        run_git(&main_path, &["init", "-b", "main"]).unwrap();
        run_git(&main_path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&main_path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(main.join("a.txt"), "hi").unwrap();
        run_git(&main_path, &["add", "."]).unwrap();
        run_git(&main_path, &["commit", "-m", "init"]).unwrap();
        let wt = root.join("wt");
        let wt_path = wt.to_string_lossy().to_string();
        run_git(&main_path, &["worktree", "add", &wt_path, "-b", "feature"]).unwrap();

        // Delete the worktree directory without `git worktree prune` — git
        // still reports the entry, marked `prunable`, and switching the app
        // to a nonexistent directory would strand the workspace root there.
        std::fs::remove_dir_all(&wt).unwrap();

        let items = worktree_list(&main_path).unwrap();
        assert_eq!(items.len(), 1);
        assert!(items[0].path.ends_with("/main"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_list_returns_single_item_for_a_plain_repo() {
        let dir = temp_repo_dir("wtl-single");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(dir.join("a.txt"), "hi").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "init"]).unwrap();

        let items = worktree_list(&path).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].branch.as_deref(), Some("main"));

        let _ = std::fs::remove_dir_all(&dir);
    }

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
    fn parse_commit_info_splits_fields_and_keeps_pipes_in_summary() {
        let commit =
            parse_commit_info("abc123\x1fp1 p2\x1fAda\x1f1700000000\x1ffix: a|b").unwrap();
        assert_eq!(commit.id, "abc123");
        assert_eq!(commit.parents, vec!["p1".to_string(), "p2".to_string()]);
        assert_eq!(commit.author, "Ada");
        assert_eq!(commit.timestamp, 1700000000);
        // The summary keeps a literal pipe intact; "|" is not the delimiter.
        assert_eq!(commit.summary, "fix: a|b");
    }

    #[test]
    fn parse_commit_info_keeps_a_pipe_embedded_in_the_author_name() {
        // A printable delimiter like "|" would misalign every field after
        // the author if the author name itself contained one. %x1f (ASCII
        // unit separator) can't appear in a real git author name, so a
        // literal "|" there is now just ordinary text, not a field boundary.
        let commit = parse_commit_info("abc123\x1fp1\x1fA|B\x1f1700000000\x1fmsg").unwrap();
        assert_eq!(commit.author, "A|B");
        assert_eq!(commit.timestamp, 1700000000);
        assert_eq!(commit.summary, "msg");
    }

    #[test]
    fn parse_commit_info_handles_a_root_commit_with_no_parents() {
        let commit = parse_commit_info("abc123\x1f\x1fAda\x1f1700000000\x1froot").unwrap();
        assert!(commit.parents.is_empty());
    }

    #[test]
    fn parse_commit_info_rejects_blank_lines() {
        assert!(parse_commit_info("   ").is_none());
        assert!(parse_commit_info("").is_none());
    }

    #[test]
    fn parse_commit_info_rejects_a_truncated_line() {
        assert!(parse_commit_info("abc123\x1fp1\x1fAda").is_none());
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

        let err = commit_range_files("/no/such/repo", "-x", "HEAD").unwrap_err();
        assert!(err.to_lowercase().contains("flag"), "got: {err}");
        let err = commit_range_file_diff("/no/such/repo", "HEAD", "-x", "a.txt").unwrap_err();
        assert!(err.to_lowercase().contains("flag"), "got: {err}");
    }

    #[test]
    fn commit_range_files_and_diff_between_arbitrary_commits() {
        let dir = temp_repo_dir("range-diff");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();

        std::fs::write(dir.join("a.txt"), "line1\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();
        run_git(&path, &["commit", "-m", "first"]).unwrap();
        let first = run_git(&path, &["rev-parse", "HEAD"]).unwrap().trim().to_string();

        std::fs::write(dir.join("a.txt"), "line1\nline2\n").unwrap();
        run_git(&path, &["commit", "-am", "second"]).unwrap();

        std::fs::write(dir.join("b.txt"), "new file\n").unwrap();
        run_git(&path, &["add", "b.txt"]).unwrap();
        run_git(&path, &["commit", "-am", "third"]).unwrap();
        let third = run_git(&path, &["rev-parse", "HEAD"]).unwrap().trim().to_string();

        // first..third skips the middle commit entirely — proves this isn't
        // limited to adjacent parent-child pairs like commit_details is.
        let files = commit_range_files(&path, &first, &third).unwrap();
        let mut paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec!["a.txt", "b.txt"]);
        assert!(files.iter().any(|f| f.path == "a.txt" && f.status == "M"));
        assert!(files.iter().any(|f| f.path == "b.txt" && f.status == "A"));

        let diff = commit_range_file_diff(&path, &first, &third, "a.txt").unwrap();
        assert!(diff.contains("+line2"));

        let _ = std::fs::remove_dir_all(&dir);
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
        // A root commit has no parents.
        assert!(history[0].parents.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_includes_parent_hashes_for_graph_layout() {
        let dir = temp_repo_dir("log-parents");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(dir.join("a.txt"), "one").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "first"]).unwrap();
        let first_id = run_git(&path, &["rev-parse", "--short", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        std::fs::write(dir.join("a.txt"), "two").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "second"]).unwrap();

        let history = log(&path, 10).unwrap();
        assert_eq!(history.len(), 2);
        // Newest first: the second commit's parent is the first commit.
        assert_eq!(history[0].summary, "second");
        assert_eq!(history[0].parents, vec![first_id]);
        assert!(history[1].parents.is_empty());

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
    fn file_at_rev_reads_head_and_index_versions() {
        let dir = temp_repo_dir("file_at_rev");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init"]).unwrap();
        run_git(&path, &["config", "user.name", "Test"]).unwrap();
        run_git(&path, &["config", "user.email", "test@example.com"]).unwrap();
        std::fs::write(dir.join("a.txt"), "committed\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();
        run_git(&path, &["commit", "-m", "c1"]).unwrap();
        std::fs::write(dir.join("a.txt"), "staged\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();

        assert_eq!(file_at_rev(&path, "HEAD", "a.txt").unwrap(), "committed\n");
        assert_eq!(file_at_rev(&path, ":", "a.txt").unwrap(), "staged\n");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_at_rev_missing_file_is_empty_and_bad_args_rejected() {
        let dir = temp_repo_dir("file_at_rev_missing");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init"]).unwrap();
        run_git(&path, &["config", "user.name", "Test"]).unwrap();
        run_git(&path, &["config", "user.email", "test@example.com"]).unwrap();
        std::fs::write(dir.join("a.txt"), "x\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();
        run_git(&path, &["commit", "-m", "c1"]).unwrap();

        assert_eq!(file_at_rev(&path, "HEAD", "nope.txt").unwrap(), "");
        assert_eq!(file_at_rev(&path, ":", "nope.txt").unwrap(), "");
        assert!(file_at_rev(&path, "HEAD~1", "a.txt").is_err());
        assert!(file_at_rev(&path, "HEAD", "--evil").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_at_rev_unborn_head_reads_as_empty() {
        let dir = temp_repo_dir("file_at_rev_unborn");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init"]).unwrap();
        std::fs::write(dir.join("a.txt"), "staged\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();

        // No commits yet: HEAD is unborn, so the HEAD side is an empty doc
        // (all-added diff), not an error.
        assert_eq!(file_at_rev(&path, "HEAD", "a.txt").unwrap(), "");
        assert_eq!(file_at_rev(&path, ":", "a.txt").unwrap(), "staged\n");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_file_reverts_unstaged_change() {
        let dir = temp_repo_dir("restore_file");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init"]).unwrap();
        run_git(&path, &["config", "user.name", "Test"]).unwrap();
        run_git(&path, &["config", "user.email", "test@example.com"]).unwrap();
        std::fs::write(dir.join("a.txt"), "original\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();
        run_git(&path, &["commit", "-m", "c1"]).unwrap();
        std::fs::write(dir.join("a.txt"), "dirty\n").unwrap();

        restore_file(&path, "a.txt").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("a.txt")).unwrap(),
            "original\n"
        );

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
            order: CommitOrder::Date,
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
    fn order_flag_maps_each_commit_order() {
        assert_eq!(order_flag(CommitOrder::Date), "--date-order");
        assert_eq!(order_flag(CommitOrder::Topo), "--topo-order");
    }

    #[test]
    fn graph_options_default_order_is_date() {
        assert_eq!(GraphOptions::default().order, CommitOrder::Date);
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

    #[test]
    fn commits_in_range_returns_empty_for_a_non_git_dir() {
        let dir = temp_repo_dir("commits-range-nonrepo");
        let out = git_commits_in_range_impl(&dir.to_string_lossy(), 0, i64::MAX);
        assert!(out.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn commits_in_range_rejects_a_remote_looking_cwd() {
        let out = git_commits_in_range_impl("ssh://host/repo", 0, i64::MAX);
        assert!(out.is_empty());
    }

    #[test]
    fn commits_in_range_filters_by_the_time_window() {
        let dir = temp_repo_dir("commits-range-window");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();

        // Two commits with controlled author/committer dates (epoch seconds):
        // one at t=1000s, one at t=5000s.
        std::fs::write(dir.join("a.txt"), "one").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        std::process::Command::new("git")
            .arg("-C")
            .arg(&path)
            .args(["commit", "-m", "first"])
            .env("GIT_AUTHOR_DATE", "@1000 +0000")
            .env("GIT_COMMITTER_DATE", "@1000 +0000")
            .output()
            .unwrap();

        std::fs::write(dir.join("a.txt"), "two").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        std::process::Command::new("git")
            .arg("-C")
            .arg(&path)
            .args(["commit", "-m", "second"])
            .env("GIT_AUTHOR_DATE", "@5000 +0000")
            .env("GIT_COMMITTER_DATE", "@5000 +0000")
            .output()
            .unwrap();

        // A window of [900s, 2000s] expressed in milliseconds.
        let out = git_commits_in_range_impl(&path, 900_000, 2_000_000);
        assert_eq!(out.len(), 1, "only the t=1000s commit is inside the window");
        assert_eq!(out[0].summary, "first");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
