//! Git integration backed by libgit2 (git2 crate): status, staging and commit.

use std::path::{Path, PathBuf};

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
    /// 分支 tip commit 的 committer 時間（Unix 秒），拿不到時為 0。
    /// 前端用它把「最近動過」的分支排前面。
    #[serde(rename = "lastCommitAt")]
    pub last_commit_at: i64,
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

/// `deny_unknown_fields` 是刻意的：搭配 `default`，一個拼錯或過時的欄位名
/// （例如改名前的 `branch`）會安靜地取預設值，篩選就變成「全部分支」而且不
/// 報錯。寧可讓它在反序列化階段就失敗、把錯誤送回前端。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct GraphOptions {
    /// 篩選用的分支清單；空清單代表「全部分支」。
    pub branches: Vec<String>,
    pub include_remotes: bool,
    pub include_tags: bool,
    pub include_stashes: bool,
    pub order: CommitOrder,
}

/// 對齊工具列的預設（遠端與標籤開、stash 關），不是「全部 false」。
/// 這幾個開關現在真的會拿掉 ref 裝飾，衍生出來的 all-false 預設等於「什麼
/// 都不標」——跟使用者打開分頁看到的畫面對不起來。
impl Default for GraphOptions {
    fn default() -> Self {
        Self {
            branches: Vec::new(),
            include_remotes: true,
            include_tags: true,
            include_stashes: false,
            order: CommitOrder::default(),
        }
    }
}

/// 把排序選項翻成 git log 旗標。純函式方便測試。
fn order_flag(order: CommitOrder) -> &'static str {
    match order {
        CommitOrder::Date => "--date-order",
        CommitOrder::Topo => "--topo-order",
    }
}

/// 把顯示選項翻成 git log 的 ref 範圍參數。純函式方便測試。
/// 指定分支時只給那些分支（多選為聯集）——remote/tag/stash 開關不再疊加，
/// 否則 `--remotes` 會把所有遠端分支的歷史聯集進來，預設開關全開時篩選
/// 形同失效；沒指定分支才用 --branches 含全部本地分支，並依開關疊加其他
/// ref 範圍。
///
/// `stash_tips` 是 stash_commits() 讀出來的 stash commit，開關關掉時傳空片段。
/// 之所以不像 remote/tag 那樣給一個旗標，是因為 git 沒有「所有 stash」的旗標：
/// refs/stash 只指到最新一筆，其餘藏在它的 reflog 裡，只能把 hash 一個個列出來。
fn build_log_refs(options: &GraphOptions, stash_tips: &[String]) -> Vec<String> {
    let picked: Vec<String> = options
        .branches
        .iter()
        .map(|b| b.trim())
        .filter(|b| !b.is_empty())
        .map(str::to_string)
        .collect();
    if !picked.is_empty() {
        return picked;
    }
    let mut refs: Vec<String> = vec!["--branches".to_string()];
    if options.include_remotes {
        refs.push("--remotes".to_string());
    }
    if options.include_tags {
        refs.push("--tags".to_string());
    }
    refs.extend(stash_tips.iter().cloned());
    refs
}

/// refs/stash 的 reflog 讀出來的 stash 全貌。
#[derive(Debug, Default, PartialEq, Eq)]
struct StashCommits {
    /// 每筆 stash 的 commit hash，reflog 順序（[0] 就是 stash@{0}）。
    tips: Vec<String>,
    /// git 為 stash 造的 index／untracked 輔助 commit。
    helpers: Vec<String>,
}

/// 解析 `git rev-list --no-walk --parents -g refs/stash` 的輸出。純函式方便測試。
///
/// 每行是「stash hash + 它的 parent」。第一個 parent 是 stash 當下的 HEAD，屬於
/// 真正的歷史、要留著；第二個以後是 git 自己造的 index／untracked 快照
/// （`-u` 的 stash 會有三個 parent），使用者沒提交過這些東西，畫進線圖只是雜訊。
fn parse_stash_commits(stdout: &str) -> StashCommits {
    let mut out = StashCommits::default();
    for line in stdout.lines() {
        let mut hashes = line.split_whitespace();
        let Some(tip) = hashes.next() else {
            continue;
        };
        out.tips.push(tip.to_string());
        // skip(1) 跳過 stash 的基底 commit，只收輔助 commit。
        out.helpers.extend(hashes.skip(1).map(str::to_string));
    }
    out
}

/// 讀出 repo 裡所有的 stash。沒有任何 stash 時 `git rev-list` 會非零退出
/// （`unknown revision refs/stash`），當成「沒有 stash」而不是錯誤。
fn stash_commits(repo_path: &str) -> StashCommits {
    let stdout = run_git(
        repo_path,
        &["rev-list", "--no-walk", "--parents", "-g", "refs/stash"],
    )
    .unwrap_or_default();
    parse_stash_commits(&stdout)
}

/// 依顯示開關濾掉 commit 上的 ref 裝飾。
///
/// 只把 ref 移出 `git log` 的走訪範圍是不夠的：`--decorate` 照樣會標出落在
/// 既有 commit 上的 `origin/x`、`tag: v1`。遠端分支和標籤絕大多數都指在本地
/// 歷史走得到的 commit 上，所以少了這一步，關掉開關看起來完全沒反應。
fn filter_refs(refs: Vec<GraphRef>, options: &GraphOptions) -> Vec<GraphRef> {
    refs.into_iter()
        .filter(|r| match r.kind.as_str() {
            "remote" => options.include_remotes,
            "tag" => options.include_tags,
            "stash" => options.include_stashes,
            _ => true,
        })
        .collect()
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
    // git2 includes ignored files by default, which is not what any surface
    // reading this wants: `git status` lists no such thing and neither should
    // the pane. `worktree_dirty_count` below already turns it off.
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
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

/// Every field `git worktree list --porcelain` reports about one worktree.
/// Unlike `WorktreeListItem` this keeps the bare/locked/prunable entries: the
/// worktrees manager has to be able to show a stale entry in order to prune it,
/// and a locked one in order to explain why removal is refused.
#[derive(Debug, Clone, Serialize)]
pub struct WorktreeDetail {
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    #[serde(rename = "isMain")]
    pub is_main: bool,
    pub bare: bool,
    pub locked: bool,
    #[serde(rename = "lockReason")]
    pub lock_reason: Option<String>,
    pub prunable: bool,
}

/// One parsed porcelain block, before either caller filters it.
struct WorktreeBlock {
    path: String,
    branch: Option<String>,
    head: Option<String>,
    bare: bool,
    locked: bool,
    lock_reason: Option<String>,
    prunable: bool,
}

/// Parse `git worktree list --porcelain`: blank-line-separated blocks of
/// `worktree <path>`, `HEAD <sha>`, then `branch refs/heads/<name>` or
/// `detached`, plus optional `bare` / `locked [reason]` / `prunable [reason]`
/// markers. Git always emits the main worktree first, which is the only thing
/// that distinguishes it from the linked ones.
fn parse_worktree_porcelain(stdout: &str) -> Vec<WorktreeBlock> {
    let mut blocks = Vec::new();
    let mut current: Option<WorktreeBlock> = None;

    for line in stdout.lines().chain(std::iter::once("")) {
        if line.is_empty() {
            blocks.extend(current.take());
        } else if let Some(rest) = line.strip_prefix("worktree ") {
            // Flush defensively: porcelain separates blocks with a blank line,
            // but a missing one must not merge two worktrees into one entry.
            blocks.extend(current.take());
            current = Some(WorktreeBlock {
                path: rest.to_string(),
                branch: None,
                head: None,
                bare: false,
                locked: false,
                lock_reason: None,
                prunable: false,
            });
        } else if let Some(block) = current.as_mut() {
            if let Some(rest) = line.strip_prefix("branch ") {
                block.branch = Some(rest.strip_prefix("refs/heads/").unwrap_or(rest).to_string());
            } else if let Some(rest) = line.strip_prefix("HEAD ") {
                block.head = Some(rest.to_string());
            } else if line == "bare" {
                block.bare = true;
            } else if line == "locked" {
                block.locked = true;
            } else if let Some(rest) = line.strip_prefix("locked ") {
                block.locked = true;
                block.lock_reason = Some(rest.to_string());
            } else if line == "prunable" || line.starts_with("prunable ") {
                block.prunable = true;
            }
            // `detached` is ignored: branch simply stays None for it.
        }
    }
    blocks
}

/// Lists the worktrees of the repository that can actually be switched to. A
/// `bare` block has no working tree and a `prunable` one no longer exists on
/// disk, so both are dropped — offering either as a switch target would strand
/// the app's workspace root somewhere unusable. The worktrees manager wants
/// those entries and calls `worktree_list_detailed` instead.
pub fn worktree_list(repo_path: &str) -> Result<Vec<WorktreeListItem>, String> {
    let stdout = run_git(repo_path, &["worktree", "list", "--porcelain"])?;
    Ok(parse_worktree_porcelain(&stdout)
        .into_iter()
        .filter(|block| !block.bare && !block.prunable)
        .map(|block| WorktreeListItem {
            path: block.path,
            branch: block.branch,
        })
        .collect())
}

/// Every worktree of the repository, including the bare/locked/prunable entries
/// `worktree_list` filters out.
pub fn worktree_list_detailed(repo_path: &str) -> Result<Vec<WorktreeDetail>, String> {
    let stdout = run_git(repo_path, &["worktree", "list", "--porcelain"])?;
    Ok(parse_worktree_porcelain(&stdout)
        .into_iter()
        .enumerate()
        .map(|(index, block)| WorktreeDetail {
            path: block.path,
            branch: block.branch,
            head: block.head,
            is_main: index == 0,
            bare: block.bare,
            locked: block.locked,
            lock_reason: block.lock_reason,
            prunable: block.prunable,
        })
        .collect())
}

/// The worktree a successful `worktree_add` produced.
#[derive(Debug, Clone, Serialize)]
pub struct WorktreeAddResult {
    pub path: String,
    pub branch: String,
}

/// Drop the extended-length prefix that `fs::canonicalize` adds on Windows; no
/// other path in the app carries it, so leaving it on would make comparisons
/// against a pty's or git's cwd fail.
///
/// A canonicalized UNC share comes back as `\\?\UNC\server\share`, where the
/// prefix stands in for the leading `\\` — dropping it alone would yield the
/// invalid `UNC\server\share`, so that form is rewritten rather than stripped.
///
/// Takes `windows` as a parameter rather than hiding behind `#[cfg(windows)]` so
/// the Windows behavior is exercised by a real test on the macOS dev box, where
/// cfg-gated code would never run until a user hit it.
fn strip_extended_length_prefix(path: &str, windows: bool) -> std::borrow::Cow<'_, str> {
    if !windows {
        return std::borrow::Cow::Borrowed(path);
    }
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return std::borrow::Cow::Owned(format!(r"\\{rest}"));
    }
    std::borrow::Cow::Borrowed(path.strip_prefix(r"\\?\").unwrap_or(path))
}

/// An absolute path with symlinks resolved, so it compares equal to the cwds git
/// and the pty report (a macOS temp dir is /var, which resolves to /private/var).
/// Falls back to the input when the path cannot be canonicalized.
fn canonical_string(path: &Path) -> String {
    let Ok(resolved) = std::fs::canonicalize(path) else {
        return path.to_string_lossy().to_string();
    };
    let text = resolved.to_string_lossy().to_string();
    strip_extended_length_prefix(&text, cfg!(windows)).into_owned()
}

/// Add a worktree at `path`. With `create_branch` the branch is created from
/// `base` (or HEAD when None); otherwise an existing branch is checked out there.
///
/// Never passes `--force`. Git's refusal on a collision, or on a branch already
/// checked out elsewhere, is a safety net worth keeping rather than routing
/// around — the pre-flight below only exists to turn those into our own
/// actionable errors instead of raw stderr.
pub fn worktree_add(
    repo_path: &str,
    path: &str,
    branch: &str,
    create_branch: bool,
    base: Option<&str>,
) -> Result<WorktreeAddResult, String> {
    ensure_not_flag(path)?;
    ensure_not_flag(branch)?;
    if let Some(base) = base {
        ensure_not_flag(base)?;
    }

    // git resolves a relative path against its `-C repo_path`, while our own
    // pre-flight below and `canonical_string` resolve it against the app's cwd —
    // so a relative path would inspect one directory and create another, and
    // report back a path that points nowhere. The caller always computes an
    // absolute path; make that a contract instead of a silent mismatch.
    let target = Path::new(path);
    if !target.is_absolute() {
        return Err(format!("worktree path must be absolute: {path}"));
    }

    // Reject a non-empty target before git touches it, so a user's existing
    // files are never at risk from a slug collision.
    if target.exists() {
        let occupied = std::fs::read_dir(target)
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(true);
        if occupied {
            return Err(format!("path already exists and is not empty: {path}"));
        }
    }

    if create_branch {
        let repo = Repository::open(repo_path).map_err(|e| e.message().to_string())?;
        if repo.find_branch(branch, git2::BranchType::Local).is_ok() {
            return Err(format!("branch already exists: {branch}"));
        }
    }

    // git does not create the container directory (`<repo>-worktrees/`).
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut args: Vec<&str> = vec!["worktree", "add"];
    if create_branch {
        args.extend(["-b", branch, path]);
        if let Some(base) = base {
            args.push(base);
        }
    } else {
        args.extend([path, branch]);
    }
    run_git(repo_path, &args)?;

    Ok(WorktreeAddResult {
        path: canonical_string(target),
        branch: branch.to_string(),
    })
}

/// Remove a worktree, and optionally the branch it had checked out.
///
/// Never passes `--force`: git's refusal on a dirty worktree is the last safety
/// net behind the UI's uncommitted-changes block. The branch is deleted only
/// when asked, and only after the worktree is gone — git refuses to delete a
/// branch that is still checked out somewhere.
pub fn worktree_remove(
    repo_path: &str,
    path: &str,
    delete_branch: Option<&str>,
    force_delete_branch: bool,
    force: bool,
) -> Result<(), String> {
    ensure_not_flag(path)?;
    if let Some(branch) = delete_branch {
        ensure_not_flag(branch)?;
    }

    // Without `force`, git refuses a worktree holding uncommitted work. That
    // refusal is the last safety net behind the UI's own block, and it stays the
    // default: `force` exists only so a user who has read the count and said in
    // so many words that they want the work discarded is not sent to a terminal
    // to do it. It is never passed on their behalf.
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(path);
    run_git(repo_path, &args)?;

    if let Some(branch) = delete_branch {
        let flag = if force_delete_branch { "-D" } else { "-d" };
        run_git(repo_path, &["branch", flag, branch])?;
    }
    Ok(())
}


/// Carry a repo's gitignored local files into a fresh worktree.
///
/// `git worktree add` gives you tracked source only, so a new worktree has no
/// `.env` — and an agent's first command dies on it. This copies the files a
/// user names (default `**/.env*`) from the repo into the worktree, and returns
/// the repo-relative paths actually copied so the UI can say what it did.
///
/// **Which files exist is git's answer, not ours.** `git status --porcelain -z
/// --ignored` lists ignored *files* one by one but collapses an ignored
/// *directory* to a single entry it never descends into — which is exactly the
/// rule this needs, because `node_modules/foo/.env` is not the user's file and
/// copying it would conjure a dependency tree in a worktree that has none. Doing
/// that walk by hand means reimplementing git's ignore resolution, and a
/// hand-rolled matcher that reads only the root `.gitignore` silently disagrees
/// with git the moment a repo declares `node_modules/` in `packages/app/`.
/// Nested ignores, `core.excludesFile` and `.git/info/exclude` all come along
/// for free this way.
///
/// `globs` come from a text field the user edits, so they are input rather than
/// configuration:
///
/// - An empty list means **copy nothing**. An override set with no patterns
///   matches everything, so failing open here would turn a cleared settings
///   field into "copy my entire working tree".
/// - `.git` is never copied whatever the glob says: a worktree's `.git` is a
///   file pointing back at the repo, and overwriting it with the repo's own
///   `.git` directory would detach the worktree from git.
pub fn copy_local_files(
    repo_path: &str,
    worktree_path: &str,
    globs: &[String],
) -> Result<Vec<String>, String> {
    use ignore::overrides::OverrideBuilder;

    let repo = Path::new(repo_path);
    let dest_root = Path::new(worktree_path);
    if !repo.is_absolute() || !dest_root.is_absolute() {
        return Err("repo and worktree paths must be absolute".to_string());
    }
    // A worktree inside the repo (or the reverse) makes the copy find its own
    // output: git would report the destination's files as ignored too, and each
    // pass would copy the last one's work.
    let repo_real = repo.canonicalize().unwrap_or_else(|_| repo.to_path_buf());
    let dest_real = dest_root
        .canonicalize()
        .unwrap_or_else(|_| dest_root.to_path_buf());
    if dest_real.starts_with(&repo_real) || repo_real.starts_with(&dest_real) {
        return Err(format!(
            "worktree must not be inside the repo, or the repo inside it: {worktree_path}"
        ));
    }

    let mut builder = OverrideBuilder::new(repo);
    let mut patterns = 0;
    for glob in globs {
        let pattern = glob.trim();
        if pattern.is_empty() {
            continue;
        }
        if pattern.starts_with('!') {
            return Err(format!("glob cannot be a negation: {pattern}"));
        }
        builder
            .add(pattern)
            .map_err(|e| format!("bad glob {pattern}: {e}"))?;
        patterns += 1;
    }
    // Nothing asked for, nothing done. `Override::matched` short-circuits on an
    // empty set and reports every path as unfiltered, which the copy would read
    // as a match — so this early return is load-bearing, not tidiness.
    if patterns == 0 {
        return Ok(Vec::new());
    }
    let overrides = builder.build().map_err(|e| e.to_string())?;

    // NUL-separated so paths keep their own bytes: the default format quotes
    // anything with a space or a non-ASCII character.
    let (stdout, _) = run_git_streams(repo_path, &["status", "--porcelain", "-z", "--ignored"])?;
    let mut copied = Vec::new();

    for entry in stdout.split('\0') {
        // `XY path`: only the ignored ones, and only the files. git marks an
        // ignored directory with a trailing slash and never looks inside it —
        // neither should we.
        let Some(relative) = entry.strip_prefix("!! ") else {
            continue;
        };
        if relative.is_empty() || relative.ends_with('/') {
            continue;
        }
        let relative = Path::new(relative);
        if relative.components().any(|c| {
            c.as_os_str()
                .to_str()
                .is_some_and(|name| name.eq_ignore_ascii_case(".git"))
        }) {
            continue;
        }
        if !overrides.matched(relative, false).is_whitelist() {
            continue;
        }

        let source = repo.join(relative);
        // git reports what it saw; between then and now it could be anything.
        if !source.is_file() {
            continue;
        }
        let dest = dest_root.join(relative);
        // A worktree that already has the file has a reason to; the user's own
        // edit is not ours to overwrite.
        if dest.exists() {
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(&source, &dest).map_err(|e| e.to_string())?;
        copied.push(relative.to_string_lossy().replace('\\', "/"));
    }

    copied.sort();
    Ok(copied)
}

/// Drop the metadata of worktrees whose directory is gone, returning git's own
/// report of what it removed so the UI can say more than "done".
///
/// `prune -v` prints that report on **stderr**, not stdout (verified against git
/// 2.54), which is why this reaches for `run_git_streams`.
pub fn worktree_prune(repo_path: &str) -> Result<Vec<String>, String> {
    let (_, stderr) = run_git_streams(repo_path, &["worktree", "prune", "-v"])?;
    Ok(stderr
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

/// How many files in a worktree are modified or untracked. The manager renders
/// one dot per row, so this returns the count rather than `status`'s full file
/// list — shipping N complete status payloads to draw N booleans is waste.
pub fn worktree_dirty_count(path: &str) -> Result<usize, String> {
    let repo = Repository::open(path).map_err(|e| e.message().to_string())?;
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    let statuses = repo
        .statuses(Some(&mut options))
        .map_err(|e| e.message().to_string())?;
    Ok(statuses.len())
}

/// Total bytes of the files under `path`, walked iteratively, never following
/// symlinks (`DirEntry::metadata` does not traverse them). A worktree that has
/// had `pnpm install` run in it is tens of thousands of files, which is why the
/// manager only ever asks for this lazily, one row at a time.
pub fn worktree_disk_size(path: &str) -> Result<u64, String> {
    let root = PathBuf::from(path);
    if !root.exists() {
        return Err(format!("path does not exist: {path}"));
    }

    let mut total: u64 = 0;
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        // A directory that vanished or is unreadable mid-walk is not worth
        // failing the whole measurement over.
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let at_root = dir == root;
        for entry in entries.flatten() {
            // `.git` at the root is git's own storage, not the checkout. In the
            // main worktree that is the whole object database — tens of
            // thousands of loose objects to stat, and not bytes that removing a
            // worktree would reclaim; in a linked one it is just a pointer file.
            // Skipping it keeps the number comparable across rows and keeps the
            // most-clicked row off the expensive path.
            if at_root && entry.file_name() == ".git" {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_dir() {
                stack.push(entry.path());
            } else if meta.is_file() {
                total += meta.len();
            }
            // Symlinks are neither followed nor counted.
        }
    }
    Ok(total)
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
pub async fn git_commits_in_range(
    cwd: String,
    since_ms: i64,
    until_ms: i64,
) -> Result<Vec<CommitInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || git_commits_in_range_impl(&cwd, since_ms, until_ms))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_resolve_repo(path: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || resolve_repo(&path))
        .await
        .ok()
        .flatten()
}

// Async so the git2 status walk runs off the main GUI thread. This is what the
// source-control panel calls on open/refresh; a slow repo would otherwise freeze
// the whole app (same rationale as git_worktree_info). All the git commands below
// follow this pattern for the same reason.
#[tauri::command]
pub async fn git_status(repo_path: String) -> Result<GitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || status(&repo_path))
        .await
        .map_err(|e| e.to_string())?
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
pub async fn git_worktree_list_detailed(path: String) -> Result<Vec<WorktreeDetail>, String> {
    tauri::async_runtime::spawn_blocking(move || worktree_list_detailed(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_worktree_add(
    repo_path: String,
    path: String,
    branch: String,
    create_branch: bool,
    base: Option<String>,
) -> Result<WorktreeAddResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        worktree_add(&repo_path, &path, &branch, create_branch, base.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_worktree_remove(
    repo_path: String,
    path: String,
    delete_branch: Option<String>,
    force_delete_branch: bool,
    force: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        worktree_remove(
            &repo_path,
            &path,
            delete_branch.as_deref(),
            force_delete_branch,
            force,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Carry a repo's gitignored local files (default `**/.env*`) into a fresh
/// worktree, which `git worktree add` leaves without them.
#[tauri::command]
pub async fn git_worktree_copy_local_files(
    repo_path: String,
    worktree_path: String,
    globs: Vec<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_local_files(&repo_path, &worktree_path, &globs)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_worktree_prune(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || worktree_prune(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_worktree_dirty_count(path: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || worktree_dirty_count(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Deliberately not called for every row on open: a full walk of a worktree that
/// has node_modules is tens of thousands of files. The manager asks lazily.
#[tauri::command]
pub async fn git_worktree_disk_size(path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || worktree_disk_size(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stage(repo_path: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || stage(&repo_path, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage(repo_path: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || unstage(&repo_path, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || commit(&repo_path, &message))
        .await
        .map_err(|e| e.to_string())?
}

/// A `git -C <repo_path> <args...>` command with the Windows console suppressed.
fn git_command(repo_path: &str, args: &[&str]) -> std::process::Command {
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
    command
}

/// Run a git subcommand against `repo_path` using the system git binary. This
/// reuses the user's configured credentials/helpers, which matters for push.
fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = git_command(repo_path, args)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Like `run_git`, but also yields stderr on success. Needed because some git
/// subcommands report their result there rather than on stdout — `worktree
/// prune -v` is the one this exists for.
fn run_git_streams(repo_path: &str, args: &[&str]) -> Result<(String, String), String> {
    let output = git_command(repo_path, args)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok((
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ))
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

/// Content of `path` at `rev`. "HEAD" is the last commit and ":" is the index;
/// anything else is resolved as a rev, so a branch, tag or hash can be read
/// too — the comparison base in #398 needs that.
///
/// The two-value whitelist that used to stand here was doing double duty: it
/// picked the supported revs *and*, as a side effect, validated them, since a
/// literal cannot be anything else. Opening it up means the validation has to
/// be said out loud, so the rev is resolved with `rev-parse --verify` before it
/// is used. That both rejects nonsense and keeps a value that happens to look
/// like an option out of the argv (`ensure_not_flag` only catches a leading
/// dash).
///
/// A file missing at that rev is an empty document, not an error, so new files
/// diff as all-added.
pub fn file_at_rev(repo_path: &str, rev: &str, path: &str) -> Result<String, String> {
    ensure_not_flag(rev)?;
    if rev != "HEAD" && rev != ":" {
        // `--verify` makes rev-parse fail rather than echo the string back,
        // and `^{commit}` refuses a tree or a blob: what is wanted here is a
        // point in history, not any object that happens to be nameable.
        run_git(repo_path, &["rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")])
            .map_err(|_| format!("unknown rev: {rev}"))?;
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
                // Some paths with no entry are refused as an unresolvable
                // argument rather than reported as a missing file -- seen on an
                // untracked file in a directory holding no tracked ones. Which
                // wording git picks varies by repository and the caller cannot
                // tell them apart; both mean the same thing here.
                || err.contains("unknown revision or path not in the working tree")
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
    let skip_arg = format!("--skip={skip}");

    // 分支清單是從前端的選單挑出來的，正常不會有幾百筆。設上限的理由是超長的
    // argv 會讓 spawn 直接失敗，而 graph_log 的錯誤被呼叫端 unwrap_or_default
    // 吞成一張空圖，使用者只看到「沒有 commit」卻不知道原因；擋在這裡至少會回
    // 一個說得出原因的錯誤。
    const MAX_BRANCH_FILTERS: usize = 256;
    const MAX_BRANCH_NAME_LEN: usize = 255;
    if options.branches.len() > MAX_BRANCH_FILTERS {
        return Err(format!(
            "too many branch filters: {} (max {MAX_BRANCH_FILTERS})",
            options.branches.len()
        ));
    }

    // 指定分支會當成位置參數傳給 git，先擋掉開頭是 - 的值。
    for branch in &options.branches {
        let branch = branch.trim();
        if !branch.is_empty() {
            if branch.len() > MAX_BRANCH_NAME_LEN {
                return Err(format!(
                    "branch name too long: {} bytes (max {MAX_BRANCH_NAME_LEN})",
                    branch.len()
                ));
            }
            ensure_not_flag(branch)?;
        }
    }

    // 只有「全部分支」模式才疊加 stash，跟 remote/tag 開關同一個規則。
    let stashes = if options.include_stashes {
        stash_commits(repo_path)
    } else {
        StashCommits::default()
    };

    let ref_args = build_log_refs(options, &stashes.tips);
    // 輔助 commit 會在下面被濾掉，所以多抓它們的份，否則整頁被扣掉幾筆之後
    // has_more 會提早變成 false，把還沒讀到的歷史藏起來。
    let max_count = format!("--max-count={}", limit + 1 + stashes.helpers.len());
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

    let mut commits: Vec<GraphCommit> = stdout
        .lines()
        .filter_map(parse_graph_commit)
        .map(|mut c| {
            c.refs = filter_refs(c.refs, options);
            c
        })
        .collect();
    // %h 是縮寫 hash，stash 那邊拿到的是完整 SHA，所以比前綴。縮寫本來就保證
    // 在這個 repo 內唯一，前綴相符即同一個 commit。
    //
    // parents 也要一起清：一個指向已被移除的 commit 的 parent 是懸空的，而前端
    // 的 lane 配置會替每個 parent 佔一條線且永遠等不到它被釋放。四筆 stash 就
    // 足以把 lane 撐過 maxLane，超出的 lane 會被壓到同一欄，兩個節點疊在同一個
    // x 上，看起來就多出一條根本不存在的父子線。
    if !stashes.helpers.is_empty() {
        let is_helper =
            |hash: &str| !hash.is_empty() && stashes.helpers.iter().any(|h| h.starts_with(hash));
        commits.retain(|c| !is_helper(&c.hash));
        for commit in &mut commits {
            commit.parents.retain(|p| !is_helper(p));
        }
    }
    label_stashes(&mut commits, &stashes.tips);
    let has_more = commits.len() > limit;
    if has_more {
        commits.truncate(limit);
    }
    Ok(GraphLog { commits, has_more })
}

/// 把每筆 stash 標成 `stash@{n}`，對齊 `git stash list` 的叫法。
///
/// git 只會裝飾 `refs/stash`（也就是 stash@{0}），較舊的那幾筆在 reflog 裡、
/// 沒有 ref 可標，不補的話它們會變成一排沒有任何標籤的 "WIP on ..." commit。
fn label_stashes(commits: &mut [GraphCommit], tips: &[String]) {
    for (index, tip) in tips.iter().enumerate() {
        let name = format!("stash@{{{index}}}");
        for commit in commits.iter_mut() {
            if commit.hash.is_empty() || !tip.starts_with(&commit.hash) {
                continue;
            }
            commit.refs.retain(|r| r.kind != "stash");
            commit.refs.push(GraphRef {
                name: name.clone(),
                kind: "stash".to_string(),
            });
            break;
        }
    }
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
            // 取 tip 時間要讀一次 object，所以放在名字的 guard 之後，別為了會被
            // 丟掉的 entry 白跑一趟。
            let last_commit_at = branch_tip_time(&branch);
            out.push(BranchInfo {
                name,
                is_current,
                is_remote: false,
                last_commit_at,
            });
        }
    }

    let remote = repo
        .branches(Some(git2::BranchType::Remote))
        .map_err(|e| e.message().to_string())?;
    for entry in remote {
        let (branch, _) = entry.map_err(|e| e.message().to_string())?;
        if let Some(name) = branch.name().map_err(|e| e.message().to_string())? {
            // 跳過 origin/HEAD 這種 symbolic ref，它只是指向預設分支。每個設好的
            // remote 都有一個，所以這個 continue 擺在讀 tip 時間之前才划算。
            if name.ends_with("/HEAD") {
                continue;
            }
            let last_commit_at = branch_tip_time(&branch);
            out.push(BranchInfo {
                name: name.to_string(),
                is_current: false,
                is_remote: true,
                last_commit_at,
            });
        }
    }

    Ok(out)
}

/// 分支 tip commit 的 committer 時間（Unix 秒）；解析失敗以 0 墊底，
/// 讓排序時自然沉到最後而不是整個清單失敗。
fn branch_tip_time(branch: &git2::Branch<'_>) -> i64 {
    branch
        .get()
        .peel_to_commit()
        .map(|c| c.time().seconds())
        .unwrap_or(0)
}

/// 一個可以拿來當比較基準的 ref。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ComparisonBase {
    /// ref 的短名字，例如 `upstream/main`、`origin/local/pending-prs`、`master`。
    pub name: String,
    /// 它為什麼在清單上：`remoteDefault`（某個遠端的預設分支）、
    /// `upstream`（目前分支的追蹤分支）、`localDefault`（本地的 main/master/develop）。
    pub kind: String,
    /// tip commit 的 committer 時間（Unix 秒），拿不到時為 0。
    #[serde(rename = "lastCommitAt")]
    pub last_commit_at: i64,
}

/// 候選基準加上建議值。fallback 的順序留在後端，前端只負責畫 —— 散在前端的話
/// 兩邊各有一份順序，遲早會不一致。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ComparisonBases {
    pub bases: Vec<ComparisonBase>,
    /// 照順序找到的第一個；一個都沒有時是 None，這時前端該讓使用者自己挑，
    /// 不要猜。
    pub suggested: Option<String>,
}

/// 每個遠端的預設分支、目前分支的追蹤分支，以及本地的 main/master/develop。
///
/// 遠端預設分支讀的是 `<remote>/HEAD`，那是 clone 時建立的 symbolic ref。它
/// **不保證存在** —— 用 `git remote add` 手動加的遠端就沒有，要跑過
/// `git remote set-head <remote> -a` 才會建。所以拿不到就跳過那個遠端，不猜。
///
/// 每個遠端都列，不是只有 origin：fork 流程下 `origin` 是自己的 fork、
/// `upstream` 才是 PR 要開回去的主 repo，兩個都有人要拿來比。
///
/// 注意這裡**刻意不沿用** `branches()` 過濾掉 `*/HEAD` 的那段。在 ref chip 的
/// 脈絡下那個過濾是對的（它只是指標，沒有自己的資訊），但這支要的正是它指到
/// 哪裡。
pub fn comparison_bases(repo_path: &str) -> Result<ComparisonBases, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.message().to_string())?;
    let mut bases: Vec<ComparisonBase> = Vec::new();

    let mut push = |name: String, kind: &str| {
        if bases.iter().any(|b| b.name == name) {
            return;
        }
        let last_commit_at = repo
            .revparse_single(&name)
            .ok()
            .and_then(|obj| obj.peel_to_commit().ok())
            .map(|c| c.time().seconds())
            .unwrap_or(0);
        bases.push(ComparisonBase { name, kind: kind.to_string(), last_commit_at });
    };

    // 1. 各遠端的預設分支。remotes() 的順序是 git 自己的（字典序），照它走，
    //    這樣同一個 repo 每次拿到的清單順序一致。
    if let Ok(remotes) = repo.remotes() {
        for remote in remotes.iter().flatten() {
            let head = format!("refs/remotes/{remote}/HEAD");
            let Ok(reference) = repo.find_reference(&head) else {
                continue;
            };
            // symbolic_target 才是它指到的分支；直接讀 name 只會拿回
            // "origin/HEAD" 本身。少數 repo 那裡是 peeled 的直接 ref，沒有
            // symbolic target 可讀，而退回它自己的名字沒有意義，所以跳過。
            let Some(target) = reference.symbolic_target() else {
                continue;
            };
            let Some(short) = target.strip_prefix("refs/remotes/") else {
                continue;
            };
            push(short.to_string(), "remoteDefault");
        }
    }

    // 2. 目前分支的追蹤分支 —— 「我 commit 了但還沒推上去的」。分支沒設追蹤
    //    （剛開的本地分支）就沒有這一項。
    if let Ok(head) = repo.head() {
        if head.is_branch() {
            if let Some(short) = head.shorthand() {
                if let Ok(branch) = repo.find_branch(short, git2::BranchType::Local) {
                    if let Ok(upstream) = branch.upstream() {
                        if let Ok(Some(name)) = upstream.name() {
                            push(name.to_string(), "upstream");
                        }
                    }
                }
            }
        }
    }

    // 3. 本地主線，給沒有遠端的 repo。
    for name in ["main", "master", "develop"] {
        if repo.find_branch(name, git2::BranchType::Local).is_ok() {
            push(name.to_string(), "localDefault");
        }
    }

    // 建議值就是照這個順序找到的第一個。三種都沒有時回 None：與其猜一個可能
    // 不相干的分支，不如讓前端問。
    let suggested = bases.first().map(|b| b.name.clone());
    Ok(ComparisonBases { bases, suggested })
}

/// 一個標籤,加上它的時間 —— 前端用它跟分支一起排「最近動過的」。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TagInfo {
    pub name: String,
    /// 附註標籤是打標籤的時間,輕量標籤是那個 commit 的時間;拿不到為 0。
    #[serde(rename = "lastCommitAt")]
    pub last_commit_at: i64,
}

/// 列出所有標籤。
///
/// 比較基準的選單要的是「有名字的東西」,而標籤和分支一樣是名字 —— 「和上一版
/// 差在哪」是會重複問的問題。這之前沒有指令可用:標籤只在 git log 的裝飾裡被
/// 解析出來,那是給 ref chip 用的,拿不到不在最近幾百個 commit 上的標籤。
pub fn tags(repo_path: &str) -> Result<Vec<TagInfo>, String> {
    let out = run_git(
        repo_path,
        &["for-each-ref", "--format=%(refname:short)%09%(creatordate:unix)", "refs/tags"],
    )?;
    Ok(out
        .lines()
        .filter_map(|line| {
            let (name, when) = line.split_once('\t')?;
            if name.is_empty() {
                return None;
            }
            Some(TagInfo {
                name: name.to_string(),
                last_commit_at: when.trim().parse().unwrap_or(0),
            })
        })
        .collect())
}

/// 解不出來是 `Ok(None)` 而不是 `Err`:那是這支要回答的問題,不是它失敗了。
pub fn resolve_rev(repo_path: &str, rev: &str) -> Result<Option<String>, String> {
    let rev = rev.trim();
    if rev.is_empty() {
        return Ok(None);
    }
    ensure_not_flag(rev)?;
    Ok(
        run_git(repo_path, &["rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")])
            .ok()
            .map(|out| out.trim().to_string())
            .filter(|sha| !sha.is_empty()),
    )
}

/// 一次比較的結果:解出來的起點,加上它對工作區的完整 diff。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BaseDiff {
    /// 解出來的起點 sha。前端拿它去讀每個檔在那一版的內容,所以要跟下面那份
    /// diff 是同一個點 —— 各自再解一次會在別人正好 push 的時候對不起來。
    pub rev: String,
    /// `git diff <rev>` 的輸出:那個起點和工作區之間的全部差異。
    pub diff: String,
}

/// `base` 和工作區之間的差異,合成一份。
///
/// #398 談定的是「拿 merge base 對工作區跑一次」而不是拼兩段:已 commit 的和
/// 還沒 commit 的接在一起看,reviewer 一次看到總量比較好判斷。所以這裡不是
/// `from..to` —— 右邊不是某個 commit,是磁碟上的檔案。
///
/// `merge_base` 為真時起點是分家那一點,而不是 `base` 現在的樣子:否則主線在
/// 你離開之後多出來的 commit 會被算成你的變更。
/// `to` names the far end. Absent it is the working tree (or HEAD, per
/// `include_uncommitted`); naming a commit makes this a comparison between
/// two points, where neither end is anything on disk and the uncommitted
/// flag has nothing to say.
pub fn diff_from_base(
    repo_path: &str,
    base: &str,
    merge_base: bool,
    include_uncommitted: bool,
    to: Option<&str>,
) -> Result<BaseDiff, String> {
    let base = base.trim();
    if base.is_empty() {
        return Err("base is required".to_string());
    }
    ensure_not_flag(base)?;
    // Where the two parted is a question about this branch and the one it left;
    // a far end names both sides outright. Asking for both would measure from
    // the merge base to a point that had nothing to do with it, which is
    // neither thing a caller can mean -- and the merge base is this command's
    // default, so an added caller that forgot to say otherwise would be handed
    // that third answer without being told.
    if merge_base && to.is_some() {
        return Err("a far end and a merge base are different questions".to_string());
    }
    let rev = if merge_base {
        // `merge-base` answers "these two never met" by exiting non-zero with
        // nothing on either stream, so an empty message is its answer rather
        // than a missing one. Whatever it does say -- a base it cannot resolve
        // -- is git's own account, and reads better than ours would.
        match run_git(repo_path, &["merge-base", base, "HEAD"]) {
            Ok(out) if out.trim().is_empty() => {
                return Err(format!("no common history with {base}"))
            }
            Ok(out) => out.trim().to_string(),
            Err(e) if e.is_empty() => return Err(format!("no common history with {base}")),
            Err(e) => return Err(e),
        }
    } else {
        run_git(repo_path, &["rev-parse", "--verify", "--quiet", &format!("{base}^{{commit}}")])
            .map_err(|_| format!("unknown rev: {base}"))?
            .trim()
            .to_string()
    };
    // No second end means the working tree, which is the whole point of this
    // command; naming HEAD instead stops at the last commit, for reading back
    // what a branch changed without the mess still on disk.
    let diff = match to {
        // Two named points: the working tree is not involved either side, so
        // the uncommitted flag has nothing to say about it.
        Some(to) => {
            let to = to.trim();
            ensure_not_flag(to)?;
            // The sha this resolves to is what gets compared, the same way the
            // near end is. Handing the name back to `git diff` would resolve it
            // a second time -- the very thing `rev` exists to stop -- and a
            // name that is also a path on disk stops git dead: "ambiguous
            // argument 'src': both revision and filename". A branch called
            // `src` or `docs` is not exotic.
            let far = run_git(
                repo_path,
                &["rev-parse", "--verify", "--quiet", &format!("{to}^{{commit}}")],
            )
            .map_err(|_| format!("unknown rev: {to}"))?
            .trim()
            .to_string();
            run_git(repo_path, &["diff", &rev, &far, "--"])?
        }
        None if include_uncommitted => run_git(repo_path, &["diff", &rev, "--"])?,
        None => run_git(repo_path, &["diff", &rev, "HEAD", "--"])?,
    };
    Ok(BaseDiff { rev, diff })
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

/// The two ends of a range as git argv, either two-dot or three-dot.
///
/// Two-dot is the literal difference between the two trees. Three-dot starts
/// from where they diverged, which is what "what does this branch change"
/// means -- without it, every commit the other side gained in the meantime is
/// counted as yours.
///
/// It is one helper because the file list and the per-file diff have to agree.
/// They are two commands running two git invocations, and if only one of them
/// learns about three-dot the list and the diffs disagree by exactly the
/// commits made on the base since the branch left it -- silently, with no
/// error, just a file too many or too few.
fn range_spec(from: &str, to: &str, merge_base: bool) -> String {
    if merge_base {
        format!("{from}...{to}")
    } else {
        format!("{from}..{to}")
    }
}

/// 兩個任意 commit 之間變更的檔案清單(`git diff --name-status from to`)。
/// 不像 commit_details 限定「對第一個 parent」，from/to 可以是歷史上任意兩點。
pub fn commit_range_files(
    repo_path: &str,
    from: &str,
    to: &str,
    merge_base: bool,
) -> Result<Vec<CommitFileChange>, String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() || to.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(from)?;
    ensure_not_flag(to)?;

    let spec = range_spec(from, to, merge_base);
    let name_status = run_git(repo_path, &["diff", "--name-status", &spec])?;
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
    merge_base: bool,
) -> Result<String, String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() || to.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(from)?;
    ensure_not_flag(to)?;

    let spec = range_spec(from, to, merge_base);
    run_git(repo_path, &["diff", &spec, "--", file])
}

#[tauri::command]
pub async fn git_log(repo_path: String, limit: Option<usize>) -> Result<Vec<CommitInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || log(&repo_path, limit.unwrap_or(50)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_diff(repo_path: String, staged: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || diff(&repo_path, staged))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_file_at_rev(
    repo_path: String,
    rev: String,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || file_at_rev(&repo_path, &rev, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_restore_file(repo_path: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || restore_file(&repo_path, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_push(repo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || push(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_fetch(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || fetch(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_graph_log(
    repo_path: String,
    limit: Option<usize>,
    skip: Option<usize>,
    options: Option<GraphOptions>,
) -> Result<GraphLog, String> {
    tauri::async_runtime::spawn_blocking(move || {
        graph_log(
            &repo_path,
            limit.unwrap_or(300),
            skip.unwrap_or(0),
            &options.unwrap_or_default(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_comparison_bases(repo_path: String) -> Result<ComparisonBases, String> {
    tauri::async_runtime::spawn_blocking(move || comparison_bases(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || branches(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_checkout(repo_path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || branch_checkout(&repo_path, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_create_at(
    repo_path: String,
    name: String,
    commit: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || branch_create_at(&repo_path, &name, &commit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_delete(
    repo_path: String,
    name: String,
    force: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || branch_delete(&repo_path, &name, force.unwrap_or(false)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_tag_create(
    repo_path: String,
    name: String,
    commit: String,
    message: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        tag_create(&repo_path, &name, &commit, message.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_tag_delete(repo_path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || tag_delete(&repo_path, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_merge(repo_path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || merge(&repo_path, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_revert(repo_path: String, commit: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || revert(&repo_path, &commit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_cherry_pick(repo_path: String, commit: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || cherry_pick(&repo_path, &commit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_reset(
    repo_path: String,
    commit: String,
    mode: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || reset(&repo_path, &commit, mode.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_rebase(repo_path: String, commit: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || rebase(&repo_path, &commit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_checkout_track(
    repo_path: String,
    local: String,
    remote_ref: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        branch_checkout_track(&repo_path, &local, &remote_ref)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_pull(repo_path: String, remote: String, branch: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || pull(&repo_path, &remote, &branch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_push_delete(
    repo_path: String,
    remote: String,
    branch: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || push_delete(&repo_path, &remote, &branch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit_details(
    repo_path: String,
    commit: String,
) -> Result<CommitDetails, String> {
    tauri::async_runtime::spawn_blocking(move || commit_details(&repo_path, &commit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit_file_diff(
    repo_path: String,
    commit: String,
    file: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || commit_file_diff(&repo_path, &commit, &file))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_tags(repo_path: String) -> Result<Vec<TagInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || tags(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_resolve_rev(repo_path: String, rev: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_rev(&repo_path, &rev))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_diff_from_base(
    repo_path: String,
    base: String,
    merge_base: Option<bool>,
    include_uncommitted: Option<bool>,
    to: Option<String>,
) -> Result<BaseDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        diff_from_base(
            &repo_path,
            &base,
            merge_base.unwrap_or(true),
            include_uncommitted.unwrap_or(true),
            to.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `merge_base` absent means two-dot, which is what every caller before #398
/// wanted; the file list and the per-file diff must be asked the same way or
/// they disagree without saying so.
#[tauri::command]
pub async fn git_commit_range_files(
    repo_path: String,
    from: String,
    to: String,
    merge_base: Option<bool>,
) -> Result<Vec<CommitFileChange>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        commit_range_files(&repo_path, &from, &to, merge_base.unwrap_or(false))
    })
        .await
        .map_err(|e| e.to_string())?
}

/// `merge_base` absent means two-dot, which is what every caller before #398
/// wanted; the file list and the per-file diff must be asked the same way or
/// they disagree without saying so.
#[tauri::command]
pub async fn git_commit_range_file_diff(
    repo_path: String,
    from: String,
    to: String,
    file: String,
    merge_base: Option<bool>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        commit_range_file_diff(&repo_path, &from, &to, &file, merge_base.unwrap_or(false))
    })
        .await
        .map_err(|e| e.to_string())?
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

    /// A temp repo with one commit on `main`, as (root, main worktree path).
    /// The linked worktrees the tests create live as siblings under `root`.
    fn init_main_repo(tag: &str) -> (std::path::PathBuf, String) {
        let root = temp_repo_dir(tag);
        let main = root.join("main");
        std::fs::create_dir_all(&main).unwrap();
        let main_path = main.to_string_lossy().to_string();
        run_git(&main_path, &["init", "-b", "main"]).unwrap();
        run_git(&main_path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&main_path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(main.join("a.txt"), "hi").unwrap();
        run_git(&main_path, &["add", "."]).unwrap();
        run_git(&main_path, &["commit", "-m", "init"]).unwrap();
        (root, main_path)
    }

    #[test]
    fn worktree_list_detailed_flags_the_main_worktree() {
        let (root, main_path) = init_main_repo("wtd-main");
        let wt_path = root.join("wt").to_string_lossy().to_string();
        run_git(&main_path, &["worktree", "add", &wt_path, "-b", "feature"]).unwrap();

        let items = worktree_list_detailed(&main_path).unwrap();
        assert_eq!(items.len(), 2);
        assert!(items[0].is_main);
        assert_eq!(items[0].branch.as_deref(), Some("main"));
        assert!(items[0].head.is_some());
        assert!(!items[1].is_main);
        assert_eq!(items[1].branch.as_deref(), Some("feature"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_list_detailed_keeps_the_prunable_entry_plain_list_drops() {
        // This is the whole reason the detailed command exists: the modal has to
        // be able to show (and prune) an entry whose directory is gone, which
        // worktree_list deliberately hides.
        let (root, main_path) = init_main_repo("wtd-prunable");
        let wt = root.join("wt");
        let wt_path = wt.to_string_lossy().to_string();
        run_git(&main_path, &["worktree", "add", &wt_path, "-b", "feature"]).unwrap();
        std::fs::remove_dir_all(&wt).unwrap();

        assert_eq!(worktree_list(&main_path).unwrap().len(), 1);

        let items = worktree_list_detailed(&main_path).unwrap();
        assert_eq!(items.len(), 2);
        assert!(items[1].prunable);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_list_detailed_reports_a_locked_worktree() {
        let (root, main_path) = init_main_repo("wtd-locked");
        let wt_path = root.join("wt").to_string_lossy().to_string();
        run_git(&main_path, &["worktree", "add", &wt_path, "-b", "feature"]).unwrap();
        run_git(&main_path, &["worktree", "lock", &wt_path, "--reason", "testing"]).unwrap();

        let items = worktree_list_detailed(&main_path).unwrap();
        // The reason's presence in porcelain varies by git version; the flag does not.
        assert!(items[1].locked);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_add_creates_a_new_branch_and_returns_the_canonical_path() {
        let (root, main_path) = init_main_repo("wta-new");
        let wt_path = root.join("box").join("feature-x").to_string_lossy().to_string();

        let result = worktree_add(&main_path, &wt_path, "feature-x", true, None).unwrap();

        assert_eq!(result.branch, "feature-x");
        // The container dir did not exist; worktree_add must create it (git will not).
        assert!(std::path::Path::new(&result.path).join("a.txt").exists());
        let items = worktree_list_detailed(&main_path).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].branch.as_deref(), Some("feature-x"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_add_checks_out_an_existing_branch_when_not_creating() {
        let (root, main_path) = init_main_repo("wta-existing");
        run_git(&main_path, &["branch", "existing"]).unwrap();
        let wt_path = root.join("wt").to_string_lossy().to_string();

        let result = worktree_add(&main_path, &wt_path, "existing", false, None).unwrap();

        assert_eq!(result.branch, "existing");
        let items = worktree_list_detailed(&main_path).unwrap();
        assert_eq!(items[1].branch.as_deref(), Some("existing"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_add_rejects_a_non_empty_existing_path() {
        let (root, main_path) = init_main_repo("wta-collide");
        let wt = root.join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(wt.join("keep.txt"), "mine").unwrap();
        let wt_path = wt.to_string_lossy().to_string();

        assert!(worktree_add(&main_path, &wt_path, "feature", true, None).is_err());
        // The pre-existing file must survive the rejected add.
        assert!(wt.join("keep.txt").exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_add_rejects_a_branch_that_already_exists() {
        let (root, main_path) = init_main_repo("wta-dupbranch");
        run_git(&main_path, &["branch", "taken"]).unwrap();
        let wt_path = root.join("wt").to_string_lossy().to_string();

        assert!(worktree_add(&main_path, &wt_path, "taken", true, None).is_err());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_add_requires_an_absolute_path() {
        // git resolves a relative path against `-C repo_path`; our pre-flight and
        // canonicalize resolve it against the app's cwd. Rejecting it outright is
        // the only way those two can never disagree.
        let (root, main_path) = init_main_repo("wta-relative");

        assert!(worktree_add(&main_path, "wt", "feature", true, None).is_err());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn worktree_disk_size_neither_follows_nor_counts_symlinks() {
        // `DirEntry::metadata` is lstat-equivalent ("will not traverse symlinks",
        // per std), which is what stops a symlink cycle hanging this walk and
        // stops it counting bytes that live outside the worktree. Pinned by a
        // test because it reads like an oversight and invites being "fixed" into
        // `fs::metadata`, which would traverse.
        let dir = temp_repo_dir("wtsize-symlink");
        std::fs::create_dir_all(dir.join("real")).unwrap();
        std::fs::write(dir.join("real/f.txt"), "12345").unwrap();
        std::os::unix::fs::symlink(dir.join("real"), dir.join("link_to_dir")).unwrap();
        std::os::unix::fs::symlink(dir.join("real/f.txt"), dir.join("link_to_file")).unwrap();
        // A cycle back to the root: following it would never terminate.
        std::os::unix::fs::symlink(&dir, dir.join("real/loop")).unwrap();

        // Only real/f.txt is counted, exactly once.
        assert_eq!(worktree_disk_size(&dir.to_string_lossy()).unwrap(), 5);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn worktree_add_rejects_flag_like_values() {
        let (root, main_path) = init_main_repo("wta-flag");
        let wt_path = root.join("wt").to_string_lossy().to_string();

        assert!(worktree_add(&main_path, &wt_path, "--force", true, None).is_err());
        assert!(worktree_add(&main_path, "--bad", "feature", true, None).is_err());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_remove_drops_the_worktree_but_keeps_the_branch() {
        let (root, main_path) = init_main_repo("wtr-keep");
        let wt = root.join("wt");
        let wt_path = wt.to_string_lossy().to_string();
        worktree_add(&main_path, &wt_path, "feature", true, None).unwrap();

        worktree_remove(&main_path, &wt_path, None, false, false).unwrap();

        assert!(!wt.exists());
        assert_eq!(worktree_list_detailed(&main_path).unwrap().len(), 1);
        // The branch is the user's work; removing a checkout must not delete it.
        assert!(run_git(&main_path, &["rev-parse", "--verify", "feature"]).is_ok());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_remove_deletes_the_branch_when_asked() {
        let (root, main_path) = init_main_repo("wtr-branch");
        let wt_path = root.join("wt").to_string_lossy().to_string();
        worktree_add(&main_path, &wt_path, "feature", true, None).unwrap();

        worktree_remove(&main_path, &wt_path, Some("feature"), true, false).unwrap();

        assert!(run_git(&main_path, &["rev-parse", "--verify", "feature"]).is_err());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_remove_refuses_a_dirty_worktree() {
        // We never pass --force, so git's own refusal is the last safety net
        // behind the UI's uncommitted-changes block.
        let (root, main_path) = init_main_repo("wtr-dirty");
        let wt = root.join("wt");
        let wt_path = wt.to_string_lossy().to_string();
        worktree_add(&main_path, &wt_path, "feature", true, None).unwrap();
        std::fs::write(wt.join("a.txt"), "modified").unwrap();

        assert!(worktree_remove(&main_path, &wt_path, None, false, false).is_err());
        assert!(wt.exists());

        // Forcing is possible, but only because someone read the count and said
        // in so many words that they want the work discarded. Without this the
        // worktree could never be removed from the app at all.
        worktree_remove(&main_path, &wt_path, None, false, true).unwrap();
        assert!(!wt.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_prune_clears_the_stale_entry_and_reports_it() {
        let (root, main_path) = init_main_repo("wtp");
        let wt = root.join("wt");
        let wt_path = wt.to_string_lossy().to_string();
        worktree_add(&main_path, &wt_path, "feature", true, None).unwrap();
        std::fs::remove_dir_all(&wt).unwrap();

        let removed = worktree_prune(&main_path).unwrap();

        assert!(!removed.is_empty(), "prune -v should report what it removed");
        assert_eq!(worktree_list_detailed(&main_path).unwrap().len(), 1);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_dirty_count_counts_modified_and_untracked_files() {
        let (root, main_path) = init_main_repo("wtdc");
        let main = root.join("main");
        assert_eq!(worktree_dirty_count(&main_path).unwrap(), 0);

        std::fs::write(main.join("a.txt"), "changed").unwrap();
        std::fs::write(main.join("new.txt"), "fresh").unwrap();

        assert_eq!(worktree_dirty_count(&main_path).unwrap(), 2);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn strip_extended_length_prefix_only_applies_on_windows() {
        // Runs on the mac, which is the point: the Windows arm would otherwise
        // never execute until a Windows user hit it.
        assert_eq!(
            strip_extended_length_prefix(r"\\?\C:\src\repo", true),
            r"C:\src\repo"
        );
        // A Windows path without the prefix is untouched.
        assert_eq!(
            strip_extended_length_prefix(r"C:\src\repo", true),
            r"C:\src\repo"
        );
        // A canonicalized UNC share is \\?\UNC\server\share, where the prefix
        // stands in for the leading \\; stripping it alone would leave the
        // invalid "UNC\server\share".
        assert_eq!(
            strip_extended_length_prefix(r"\\?\UNC\server\share", true),
            r"\\server\share"
        );
        // A plain UNC path never had the prefix, so it is untouched.
        assert_eq!(
            strip_extended_length_prefix(r"\\server\share", true),
            r"\\server\share"
        );
        // Off Windows the string is returned as-is, prefix-shaped or not.
        assert_eq!(
            strip_extended_length_prefix(r"\\?\C:\src\repo", false),
            r"\\?\C:\src\repo"
        );
        assert_eq!(
            strip_extended_length_prefix("/private/var/repo", false),
            "/private/var/repo"
        );
    }

    #[test]
    fn worktree_disk_size_sums_file_bytes_recursively() {
        let dir = temp_repo_dir("wtsize");
        std::fs::write(dir.join("a.txt"), "12345").unwrap();
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("b.txt"), "1234567890").unwrap();

        assert_eq!(worktree_disk_size(&dir.to_string_lossy()).unwrap(), 15);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn worktree_disk_size_excludes_gits_own_object_store() {
        // The main worktree's .git holds the whole object database. Counting it
        // would both mislead (it is not what removing a worktree reclaims) and
        // make the most-clicked row the most expensive one to measure.
        let (root, main_path) = init_main_repo("wtsize-git");

        // The checkout is a single 2-byte file; .git is orders of magnitude more.
        assert_eq!(worktree_disk_size(&main_path).unwrap(), 2);

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
        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].is_current);
        assert!(!branches[0].is_remote);
        // tip 是剛剛才提交的，時間必須被填上（0 是解析失敗的墊底值）。
        assert!(branches[0].last_commit_at > 0);

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

        let err = commit_range_files("/no/such/repo", "-x", "HEAD", false).unwrap_err();
        assert!(err.to_lowercase().contains("flag"), "got: {err}");
        let err = commit_range_file_diff("/no/such/repo", "HEAD", "-x", "a.txt", false).unwrap_err();
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
        let files = commit_range_files(&path, &first, &third, false).unwrap();
        let mut paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec!["a.txt", "b.txt"]);
        assert!(files.iter().any(|f| f.path == "a.txt" && f.status == "M"));
        assert!(files.iter().any(|f| f.path == "b.txt" && f.status == "A"));

        let diff = commit_range_file_diff(&path, &first, &third, "a.txt", false).unwrap();
        assert!(diff.contains("+line2"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn three_dot_ignores_what_the_base_gained_after_the_branch_left_it() {
        // main and feature both move after they diverge. Two-dot compares the
        // two tips, so main's own new file reads as something feature deleted;
        // three-dot starts from where they parted and reports only feature's
        // work. Getting this wrong is what makes "what does my branch change"
        // list files the branch never touched.
        let dir = temp_repo_dir("range-threedot");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(dir.join("a.txt"), "hi").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "init"]).unwrap();
        run_git(&path, &["checkout", "-q", "-b", "feature"]).unwrap();
        std::fs::write(dir.join("mine.txt"), "feature").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "feature work"]).unwrap();
        run_git(&path, &["checkout", "-q", "main"]).unwrap();
        std::fs::write(dir.join("theirs.txt"), "main").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "main moves on"]).unwrap();

        let two = commit_range_files(&path, "main", "feature", false).unwrap();
        let three = commit_range_files(&path, "main", "feature", true).unwrap();
        let names = |v: &[CommitFileChange]| {
            let mut n: Vec<String> = v.iter().map(|f| f.path.clone()).collect();
            n.sort();
            n
        };
        assert_eq!(names(&two), vec!["mine.txt".to_string(), "theirs.txt".to_string()]);
        assert_eq!(names(&three), vec!["mine.txt".to_string()]);

        // And the per-file diff has to answer the same way, or the list and
        // the diffs describe different comparisons.
        let two_diff = commit_range_file_diff(&path, "main", "feature", "theirs.txt", false).unwrap();
        let three_diff = commit_range_file_diff(&path, "main", "feature", "theirs.txt", true).unwrap();
        assert!(two_diff.contains("theirs.txt"), "{two_diff}");
        assert!(three_diff.is_empty(), "{three_diff}");

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

    /// Builds a repo with one commit on `main` and returns (dir, path).
    fn repo_with_a_commit(tag: &str) -> (std::path::PathBuf, String) {
        let dir = temp_repo_dir(tag);
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(dir.join("a.txt"), "hi").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "init"]).unwrap();
        (dir, path)
    }

    #[test]
    fn comparison_bases_lists_every_remote_default_not_just_origin() {
        // A fork checkout: `origin` is your own copy, `upstream` is the repo the
        // pull request goes back to. Both are things people compare against, so
        // both have to be offered.
        let (dir, path) = repo_with_a_commit("bases-remotes");
        let (bare_dir, bare) = repo_with_a_commit("bases-remotes-bare");
        run_git(&path, &["remote", "add", "origin", &bare]).unwrap();
        run_git(&path, &["remote", "add", "upstream", &bare]).unwrap();
        run_git(&path, &["fetch", "-q", "origin"]).unwrap();
        run_git(&path, &["fetch", "-q", "upstream"]).unwrap();
        // <remote>/HEAD is only written by clone, so a remote added by hand
        // needs this -- which is exactly why the code skips a remote without
        // one rather than guessing.
        run_git(&path, &["remote", "set-head", "origin", "-a"]).unwrap();
        run_git(&path, &["remote", "set-head", "upstream", "-a"]).unwrap();

        let found = comparison_bases(&path).unwrap();
        let names: Vec<&str> = found.bases.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"origin/main"), "{names:?}");
        assert!(names.contains(&"upstream/main"), "{names:?}");
        // The remote defaults come first, so the suggestion is one of them.
        assert!(found.suggested.as_deref() == Some("origin/main")
            || found.suggested.as_deref() == Some("upstream/main"));
        for base in &found.bases {
            if base.name.starts_with("origin/") || base.name.starts_with("upstream/") {
                assert_eq!(base.kind, "remoteDefault");
                assert!(base.last_commit_at > 0, "{base:?}");
            }
        }

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&bare_dir);
    }

    #[test]
    fn comparison_bases_skips_a_remote_with_no_head_and_falls_back_to_local() {
        // No `git remote set-head`, so there is no origin/HEAD to read. Guessing
        // "origin/main" here would be wrong on a repo whose default is
        // something else, so the remote is skipped and the local main answers.
        let (dir, path) = repo_with_a_commit("bases-nohead");
        let (bare_dir, bare) = repo_with_a_commit("bases-nohead-bare");
        run_git(&path, &["remote", "add", "origin", &bare]).unwrap();
        run_git(&path, &["fetch", "-q", "origin"]).unwrap();
        // git 2.47 and later write <remote>/HEAD on fetch as well as on clone,
        // so the case being tested has to be made rather than assumed: this is
        // the repo that has been fetched from a remote whose HEAD was never
        // resolved, which is what `git remote add` by hand leaves behind on
        // older git.
        run_git(&path, &["remote", "set-head", "origin", "-d"]).unwrap();

        let found = comparison_bases(&path).unwrap();
        let names: Vec<&str> = found.bases.iter().map(|b| b.name.as_str()).collect();
        assert!(!names.iter().any(|n| n.starts_with("origin/")), "{names:?}");
        assert_eq!(found.suggested.as_deref(), Some("main"));
        assert_eq!(found.bases[0].kind, "localDefault");

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&bare_dir);
    }

    #[test]
    fn comparison_bases_offers_the_branch_its_own_upstream() {
        // "What have I committed but not pushed" is a different question from
        // "what does my branch change against the mainline", so the tracking
        // branch is its own entry.
        let (dir, path) = repo_with_a_commit("bases-upstream");
        let (bare_dir, bare) = repo_with_a_commit("bases-upstream-bare");
        run_git(&path, &["remote", "add", "origin", &bare]).unwrap();
        run_git(&path, &["fetch", "-q", "origin"]).unwrap();
        // An upstream of its own, not the mainline: those are two different
        // questions and the list carries both.
        run_git(&bare, &["checkout", "-q", "-b", "feature"]).unwrap();
        run_git(&path, &["fetch", "-q", "origin"]).unwrap();
        run_git(&path, &["checkout", "-q", "-b", "feature"]).unwrap();
        run_git(&path, &["branch", "--set-upstream-to", "origin/feature", "feature"]).unwrap();

        let found = comparison_bases(&path).unwrap();
        let tracked = found.bases.iter().find(|b| b.kind == "upstream");
        assert_eq!(tracked.map(|b| b.name.as_str()), Some("origin/feature"));

        // And when the branch tracks the mainline itself, that is one row, not
        // the same ref listed twice under two headings.
        run_git(&path, &["branch", "--set-upstream-to", "origin/main", "feature"]).unwrap();
        let again = comparison_bases(&path).unwrap();
        assert_eq!(again.bases.iter().filter(|b| b.name == "origin/main").count(), 1);

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&bare_dir);
    }

    #[test]
    fn comparison_bases_says_nothing_rather_than_guessing() {
        // A repo with no remote and a branch called neither main nor master:
        // there is no sensible mainline to offer, so the frontend has to ask.
        let dir = temp_repo_dir("bases-empty");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "wip"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(dir.join("a.txt"), "hi").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "init"]).unwrap();

        let found = comparison_bases(&path).unwrap();
        assert!(found.bases.is_empty(), "{:?}", found.bases);
        assert_eq!(found.suggested, None);

        let _ = std::fs::remove_dir_all(&dir);
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
    fn status_leaves_ignored_files_out() {
        // git2's default is to report them, so the pane listed a repo's
        // ignored files as untracked -- next to the ones git really does call
        // untracked, with no way to tell which was which.
        let dir = temp_repo_dir("ignored-status");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(dir.join(".gitignore"), "secrets/").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "init"]).unwrap();
        std::fs::create_dir_all(dir.join("secrets")).unwrap();
        std::fs::write(dir.join("secrets/key.txt"), "shh").unwrap();
        std::fs::write(dir.join("seen.txt"), "hello").unwrap();

        let found = status(&path).unwrap();
        let untracked: Vec<&str> = found.unstaged.iter().map(|f| f.path.as_str()).collect();
        // The one git would list, and not the one it would not.
        assert!(untracked.contains(&"seen.txt"), "{untracked:?}");
        assert!(!untracked.iter().any(|p| p.starts_with("secrets")), "{untracked:?}");

        let _ = std::fs::remove_dir_all(&dir);
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
    fn tags_are_listed_with_a_time_to_sort_them_by() {
        // The base picker offers names, and a tag is a name -- "what changed
        // since the last release" is a question people ask more than once.
        // Both kinds: an annotated tag carries its own date, a lightweight one
        // borrows the commit's.
        let (dir, path) = repo_with_a_commit("tags-list");
        run_git(&path, &["tag", "v0.1"]).unwrap();
        run_git(&path, &["tag", "-a", "v0.2", "-m", "release"]).unwrap();

        let found = tags(&path).unwrap();
        let names: Vec<&str> = found.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"v0.1"), "{names:?}");
        assert!(names.contains(&"v0.2"), "{names:?}");
        for tag in &found {
            assert!(tag.last_commit_at > 0, "{tag:?}");
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_rev_answers_the_question_rather_than_failing() {
        // The base box asks this before it acts: a hash pasted from a pull
        // request is the one thing its list cannot vouch for. "No" is an
        // answer, so it comes back as None rather than as an error.
        let (dir, path) = repo_with_a_commit("resolve-rev");
        run_git(&path, &["tag", "v9"]).unwrap();
        let head = run_git(&path, &["rev-parse", "HEAD"]).unwrap().trim().to_string();

        assert_eq!(resolve_rev(&path, "HEAD").unwrap().as_deref(), Some(head.as_str()));
        assert_eq!(resolve_rev(&path, "main").unwrap().as_deref(), Some(head.as_str()));
        assert_eq!(resolve_rev(&path, "v9").unwrap().as_deref(), Some(head.as_str()));
        // A short hash resolves to the whole one, which is what makes the
        // paste-a-prefix case work.
        assert_eq!(resolve_rev(&path, &head[..7]).unwrap().as_deref(), Some(head.as_str()));

        assert_eq!(resolve_rev(&path, "no-such-thing").unwrap(), None);
        assert_eq!(resolve_rev(&path, "deadbeef").unwrap(), None);
        assert_eq!(resolve_rev(&path, "").unwrap(), None);
        // A value shaped like an option is refused outright rather than
        // answered, since answering means putting it in git's argv.
        assert!(resolve_rev(&path, "--upload-pack=x").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_base_can_be_compared_with_or_without_what_is_still_on_disk() {
        // Same base, two questions: "what does this branch change" and "what
        // does it change that I have actually committed". The second is what
        // you read before pushing.
        let (dir, path) = repo_with_a_commit("base-uncommitted");
        run_git(&path, &["checkout", "-q", "-b", "feature"]).unwrap();
        std::fs::write(dir.join("committed.txt"), "done").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "committed work"]).unwrap();
        std::fs::write(dir.join("a.txt"), "still editing").unwrap();

        let with = diff_from_base(&path, "main", true, true, None).unwrap();
        assert!(with.diff.contains("committed.txt"), "{}", with.diff);
        assert!(with.diff.contains("a.txt"), "{}", with.diff);

        let without = diff_from_base(&path, "main", true, false, None).unwrap();
        assert!(without.diff.contains("committed.txt"), "{}", without.diff);
        assert!(!without.diff.contains("a.txt"), "{}", without.diff);

        // Both read from the same point, so a file's "before" is the same
        // either way.
        assert_eq!(with.rev, without.rev);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_named_points_leave_the_working_tree_out_of_it() {
        // A range picked out of the graph: neither end is on disk, so an edit
        // in the buffer must not turn up in it however the uncommitted flag is
        // set. Two-dot as well -- these are two points, not a branch and the
        // line it left.
        let (dir, path) = repo_with_a_commit("range-two-points");
        std::fs::write(dir.join("b.txt"), "second").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "second"]).unwrap();
        let second = run_git(&path, &["rev-parse", "HEAD"]).unwrap().trim().to_string();
        std::fs::write(dir.join("scratch.txt"), "not committed").unwrap();

        let found = diff_from_base(&path, "main~1", false, true, Some(&second)).unwrap();
        assert!(found.diff.contains("b.txt"), "{}", found.diff);
        assert!(!found.diff.contains("scratch.txt"), "{}", found.diff);

        // The far end is checked like the near one: nonsense is refused rather
        // than reaching git's argv.
        assert!(diff_from_base(&path, "main", false, true, Some("no-such-rev")).is_err());
        assert!(diff_from_base(&path, "main", false, true, Some("--upload-pack=x")).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_far_end_named_after_a_folder_is_still_read_as_a_commit() {
        // Branches get called `src` and `docs`. Handing that name to `git
        // diff` stops it dead -- "ambiguous argument 'src': both revision and
        // filename" -- so the far end goes in as the sha it resolved to, the
        // same way the near end does.
        let (dir, path) = repo_with_a_commit("range-ambiguous-far-end");
        std::fs::create_dir(dir.join("src")).unwrap();
        std::fs::write(dir.join("src").join("only-here.txt"), "inside").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "a folder called src"]).unwrap();
        run_git(&path, &["branch", "src"]).unwrap();

        let found = diff_from_base(&path, "main~1", false, true, Some("src")).unwrap();

        assert!(found.diff.contains("src/only-here.txt"), "{}", found.diff);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_histories_that_never_met_say_so() {
        // `merge-base` reports it by exiting non-zero with nothing on either
        // stream. Passing that through as the error left the reader with a
        // blank message, and the line that explains it unreachable.
        let (dir, path) = repo_with_a_commit("range-no-common-history");
        run_git(&path, &["checkout", "-q", "--orphan", "stranger"]).unwrap();
        std::fs::write(dir.join("elsewhere.txt"), "unrelated").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "a history of its own"]).unwrap();

        let err = diff_from_base(&path, "main", true, true, None).unwrap_err();

        assert!(err.contains("no common history"), "{err}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_far_end_and_a_merge_base_are_refused_together() {
        // They are different questions, and the merge base is the default: an
        // added caller that named a far end and left the rest alone would be
        // measuring from where this branch parted from HEAD to a point with no
        // bearing on it, and nothing would say so.
        let (dir, path) = repo_with_a_commit("range-both-questions");

        assert!(diff_from_base(&path, "main", true, true, Some("HEAD")).is_err());

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
    fn a_path_git_will_not_resolve_reads_as_empty() {
        // The other half of "not on this side". Reading the index version of a
        // path git has no entry for can fail as an unresolvable *argument*
        // rather than as a missing file, and a surface that turned that into an
        // error showed "could not load" over a file it had just listed.
        let dir = temp_repo_dir("unresolvable");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(dir.join(".gitignore"), "secrets/").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "init"]).unwrap();
        std::fs::create_dir_all(dir.join("secrets")).unwrap();
        std::fs::write(dir.join("secrets/key.txt"), "shh").unwrap();

        assert_eq!(file_at_rev(&path, ":", "secrets/key.txt").unwrap(), "");
        assert_eq!(file_at_rev(&path, "HEAD", "secrets/key.txt").unwrap(), "");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_at_rev_reads_any_rev_and_refuses_one_that_is_not() {
        // The comparison base is a branch or a tag, so the two-value whitelist
        // had to go; what replaces it is a real resolve, which still says no.
        let dir = temp_repo_dir("far-anyrev");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(dir.join("a.txt"), "first").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "init"]).unwrap();
        std::fs::write(dir.join("a.txt"), "second").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "second"]).unwrap();
        run_git(&path, &["tag", "v1"]).unwrap();
        run_git(&path, &["checkout", "-q", "-b", "later"]).unwrap();
        std::fs::write(dir.join("a.txt"), "third").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "third"]).unwrap();

        assert_eq!(file_at_rev(&path, "v1", "a.txt").unwrap().trim(), "second");
        assert_eq!(file_at_rev(&path, "main", "a.txt").unwrap().trim(), "second");
        assert_eq!(file_at_rev(&path, "HEAD", "a.txt").unwrap().trim(), "third");
        // Still an empty document rather than an error when the file is not
        // there at that rev -- that is what makes a new file diff as all-added.
        assert_eq!(file_at_rev(&path, "main", "nope.txt").unwrap(), "");
        // Nonsense is refused rather than reaching git's argv.
        assert!(file_at_rev(&path, "no-such-branch", "a.txt").is_err());
        assert!(file_at_rev(&path, "--upload-pack=touch", "a.txt").is_err());

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
        // 預設是工具列的預設：本地分支 + 遠端 + 標籤，不含 stash。
        let options = GraphOptions::default();
        assert_eq!(
            build_log_refs(&options, &[]),
            vec![
                "--branches".to_string(),
                "--remotes".to_string(),
                "--tags".to_string(),
            ]
        );
    }

    #[test]
    fn build_log_refs_specific_branch() {
        let options = GraphOptions {
            branches: vec!["main".to_string()],
            ..GraphOptions::default()
        };
        assert_eq!(build_log_refs(&options, &[]), vec!["main".to_string()]);
    }

    #[test]
    fn build_log_refs_specific_branch_ignores_ref_toggles() {
        // 顯示開關預設全開；若還疊加 --remotes/--tags，選了分支的圖
        // 仍會畫出所有遠端分支的歷史，篩選形同失效。
        let options = GraphOptions {
            branches: vec!["main".to_string()],
            include_remotes: true,
            include_tags: true,
            include_stashes: true,
            order: CommitOrder::Date,
        };
        assert_eq!(
            build_log_refs(&options, &["deadbeef".to_string()]),
            vec!["main".to_string()]
        );
    }

    #[test]
    fn build_log_refs_multiple_branches_union() {
        let options = GraphOptions {
            branches: vec!["main".to_string(), "origin/feature".to_string()],
            include_remotes: true,
            ..GraphOptions::default()
        };
        assert_eq!(
            build_log_refs(&options, &[]),
            vec!["main".to_string(), "origin/feature".to_string()]
        );
    }

    #[test]
    fn parse_stash_commits_splits_tips_from_helpers() {
        // 每行是「stash + parent」。第一個 parent 是 stash 當下的 HEAD（真實
        // 歷史），第二個以後才是 index／untracked 快照。第一行是 `stash -u`，
        // 所以有三個 parent。
        let parsed = parse_stash_commits(
            "aaa1 base1 idx1 untracked1\nbbb2 base2 idx2\n",
        );
        assert_eq!(parsed.tips, vec!["aaa1".to_string(), "bbb2".to_string()]);
        assert_eq!(
            parsed.helpers,
            vec!["idx1".to_string(), "untracked1".to_string(), "idx2".to_string()]
        );
        // 基底 commit 不能被當成輔助 commit，否則真實歷史會被濾掉。
        assert!(!parsed.helpers.contains(&"base1".to_string()));
        assert!(!parsed.helpers.contains(&"base2".to_string()));
    }

    #[test]
    fn parse_stash_commits_of_nothing_is_empty() {
        // 沒有任何 stash 時 `git rev-list` 非零退出，呼叫端會餵進空字串。
        assert_eq!(parse_stash_commits(""), StashCommits::default());
    }

    #[test]
    fn filter_refs_drops_the_kinds_their_toggle_turned_off() {
        // 把 ref 移出 git log 的走訪範圍不會拿掉裝飾：遠端分支和標籤幾乎都指在
        // 本地歷史走得到的 commit 上，少了這層過濾，關掉開關看起來毫無反應。
        let refs = vec![
            GraphRef { name: "main".into(), kind: "head".into() },
            GraphRef { name: "v1".into(), kind: "tag".into() },
            GraphRef { name: "origin/main".into(), kind: "remote".into() },
            GraphRef { name: "stash@{0}".into(), kind: "stash".into() },
        ];
        let off = GraphOptions {
            include_remotes: false,
            include_tags: false,
            ..GraphOptions::default()
        };
        assert_eq!(
            filter_refs(refs.clone(), &off),
            vec![GraphRef { name: "main".into(), kind: "head".into() }]
        );

        let on = GraphOptions {
            include_remotes: true,
            include_tags: true,
            include_stashes: true,
            ..GraphOptions::default()
        };
        assert_eq!(filter_refs(refs.clone(), &on), refs);

        let stashes_off = GraphOptions {
            include_remotes: true,
            include_tags: true,
            include_stashes: false,
            ..GraphOptions::default()
        };
        assert_eq!(
            filter_refs(refs, &stashes_off),
            vec![
                GraphRef { name: "main".into(), kind: "head".into() },
                GraphRef { name: "v1".into(), kind: "tag".into() },
                GraphRef { name: "origin/main".into(), kind: "remote".into() },
            ]
        );
    }

    #[test]
    fn label_stashes_names_every_stash_the_way_git_stash_list_does() {
        // git 只裝飾 refs/stash（stash@{0}）；較舊的在 reflog 裡，沒有 ref 可標，
        // 不補的話會變成一排沒有標籤的 "WIP on ..." commit。
        let mut commits = vec![
            GraphCommit {
                hash: "aaa1111".into(),
                parents: vec![],
                author: "A".into(),
                date: "2024-01-01 00:00".into(),
                refs: vec![GraphRef { name: "stash".into(), kind: "stash".into() }],
                message: "WIP on main".into(),
            },
            GraphCommit {
                hash: "bbb2222".into(),
                parents: vec![],
                author: "A".into(),
                date: "2024-01-01 00:00".into(),
                refs: vec![],
                message: "WIP on main".into(),
            },
        ];
        label_stashes(
            &mut commits,
            &["aaa1111ffff".to_string(), "bbb2222ffff".to_string()],
        );
        assert_eq!(
            commits[0].refs,
            vec![GraphRef { name: "stash@{0}".into(), kind: "stash".into() }]
        );
        assert_eq!(
            commits[1].refs,
            vec![GraphRef { name: "stash@{1}".into(), kind: "stash".into() }]
        );
    }

    #[test]
    fn graph_log_rejects_an_oversized_branch_filter() {
        // 上限擋在 git 執行之前，所以這裡用不存在的路徑也測得到。超長 argv 會讓
        // spawn 失敗，而那個錯誤會被呼叫端吞成一張空圖，使用者看不出原因。
        let options = GraphOptions {
            branches: vec!["main".to_string(); 257],
            ..GraphOptions::default()
        };
        let err = graph_log("/nonexistent-repo", 100, 0, &options).unwrap_err();
        assert!(err.contains("too many branch filters"), "unexpected: {err}");
    }

    #[test]
    fn graph_log_rejects_an_overlong_branch_name() {
        let options = GraphOptions {
            branches: vec!["b".repeat(256)],
            ..GraphOptions::default()
        };
        let err = graph_log("/nonexistent-repo", 100, 0, &options).unwrap_err();
        assert!(err.contains("branch name too long"), "unexpected: {err}");
    }

    #[test]
    fn graph_options_rejects_the_pre_rename_branch_field() {
        // `branches` 改名前叫 `branch`。沒有 deny_unknown_fields 的話，送舊欄位
        // 會安靜取到預設值，篩選變成「全部分支」而且不報錯。
        let err = serde_json::from_str::<GraphOptions>(r#"{"branch":"main"}"#)
            .expect_err("the old field name must not deserialize");
        assert!(err.to_string().contains("branch"), "unexpected: {err}");
    }

    #[test]
    fn build_log_refs_blank_entries_fall_back_to_show_all() {
        let options = GraphOptions {
            branches: vec!["   ".to_string(), "".to_string()],
            include_remotes: false,
            include_tags: false,
            ..GraphOptions::default()
        };
        assert_eq!(build_log_refs(&options, &[]), vec!["--branches".to_string()]);
    }

    #[test]
    fn build_log_refs_toggles_stack() {
        let options = GraphOptions {
            branches: Vec::new(),
            include_remotes: true,
            include_tags: true,
            include_stashes: true,
            order: CommitOrder::Date,
        };
        // stash 以 commit hash 逐筆列出，不是旗標——git 沒有「所有 stash」的
        // 旗標，而 `--glob=refs/stash` 因為不含萬用字元會被 git 當成前綴、
        // 展開成 refs/stash/*，永遠匹配不到東西。
        assert_eq!(
            build_log_refs(&options, &["aaa1".to_string(), "bbb2".to_string()]),
            vec![
                "--branches".to_string(),
                "--remotes".to_string(),
                "--tags".to_string(),
                "aaa1".to_string(),
                "bbb2".to_string(),
            ]
        );
    }

    #[test]
    fn graph_log_shows_every_stash_without_its_helper_commits() {
        let dir = temp_repo_dir("graph-stash");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.name", "Test"]).unwrap();
        run_git(&path, &["config", "user.email", "test@example.com"]).unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();
        run_git(&path, &["commit", "-m", "first"]).unwrap();

        // 兩筆 stash：只有較新的那筆有 refs/stash 這個 ref，舊的在 reflog 裡。
        std::fs::write(dir.join("a.txt"), "older\n").unwrap();
        run_git(&path, &["stash"]).unwrap();
        std::fs::write(dir.join("a.txt"), "newer\n").unwrap();
        run_git(&path, &["stash"]).unwrap();

        let off = graph_log(&path, 50, 0, &GraphOptions::default()).unwrap();
        assert!(
            !off.commits.iter().any(|c| c.message.starts_with("WIP on")),
            "開關關著不該畫出 stash: {:?}",
            off.commits.iter().map(|c| &c.message).collect::<Vec<_>>()
        );

        let options = GraphOptions {
            include_stashes: true,
            ..GraphOptions::default()
        };
        let on = graph_log(&path, 50, 0, &options).unwrap();

        // 兩筆都要在，而且都被標成 stash@{n}——舊的那筆沒有 ref 可以裝飾。
        let stash_names: Vec<String> = on
            .commits
            .iter()
            .flat_map(|c| c.refs.iter())
            .filter(|r| r.kind == "stash")
            .map(|r| r.name.clone())
            .collect();
        assert_eq!(
            stash_names,
            vec!["stash@{0}".to_string(), "stash@{1}".to_string()]
        );

        // git 為 stash 造的 index 快照不是使用者的歷史，不該出現在線圖上。
        assert!(
            !on.commits.iter().any(|c| c.message.starts_with("index on")),
            "輔助 commit 漏進線圖: {:?}",
            on.commits.iter().map(|c| &c.message).collect::<Vec<_>>()
        );

        // 每個 parent 都必須指到還在清單裡的 commit。懸空的 parent 會讓前端的
        // lane 配置佔著一條永遠等不到的線，lane 一超過 maxLane 就被壓到同一欄，
        // 兩個節點疊在同一個 x 上、畫出一條不存在的父子線。
        let present: Vec<&str> = on.commits.iter().map(|c| c.hash.as_str()).collect();
        for commit in &on.commits {
            for parent in &commit.parents {
                assert!(
                    present.iter().any(|h| h == parent),
                    "{} 的 parent {parent} 不在線圖裡",
                    commit.hash
                );
            }
        }
        // 每筆 stash 只該剩下它的基底 commit 這一個 parent。
        let stash_rows: Vec<&GraphCommit> = on
            .commits
            .iter()
            .filter(|c| c.refs.iter().any(|r| r.kind == "stash"))
            .collect();
        assert_eq!(stash_rows.len(), 2);
        for commit in stash_rows {
            assert_eq!(commit.parents.len(), 1, "stash 還帶著輔助 parent: {commit:?}");
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn graph_log_hides_remote_and_tag_chips_when_their_toggle_is_off() {
        let dir = temp_repo_dir("graph-decorations");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.name", "Test"]).unwrap();
        run_git(&path, &["config", "user.email", "test@example.com"]).unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();
        run_git(&path, &["commit", "-m", "first"]).unwrap();
        run_git(&path, &["tag", "v1"]).unwrap();
        // 遠端分支和本地 HEAD 指在同一個 commit——這是實務上的常態，也正是
        // 「把 ref 移出走訪範圍」擋不掉裝飾的情境。
        run_git(&path, &["update-ref", "refs/remotes/origin/main", "HEAD"]).unwrap();

        let on = GraphOptions {
            include_remotes: true,
            include_tags: true,
            ..GraphOptions::default()
        };
        let refs = &graph_log(&path, 10, 0, &on).unwrap().commits[0].refs;
        assert!(refs.iter().any(|r| r.kind == "tag" && r.name == "v1"));
        assert!(refs.iter().any(|r| r.kind == "remote" && r.name == "origin/main"));

        let off = GraphOptions {
            include_remotes: false,
            include_tags: false,
            ..GraphOptions::default()
        };
        let refs = &graph_log(&path, 10, 0, &off).unwrap().commits[0].refs;
        assert!(!refs.iter().any(|r| r.kind == "tag"), "標籤沒被關掉: {refs:?}");
        assert!(!refs.iter().any(|r| r.kind == "remote"), "遠端沒被關掉: {refs:?}");
        // 本地分支不受這兩個開關影響。
        assert!(refs.iter().any(|r| r.kind == "head" && r.name == "main"));

        let _ = std::fs::remove_dir_all(&dir);
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
    fn graph_options_default_matches_the_toolbar() {
        // 開關會拿掉 ref 裝飾，所以衍生的 all-false 預設會變成「什麼都不標」。
        // 這些預設要跟 GitGraphTabContent 的 useState 初值一致。
        let defaults = GraphOptions::default();
        assert!(defaults.include_remotes);
        assert!(defaults.include_tags);
        assert!(!defaults.include_stashes);
        assert!(defaults.branches.is_empty());
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

    /// A repo with one commit, plus a gitignored `.env` and a heavy ignored
    /// directory — the shape `copy_local_files` exists for.
    fn repo_with_ignored_files(tag: &str) -> (std::path::PathBuf, String) {
        let dir = temp_repo_dir(tag);
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();
        std::fs::write(dir.join(".gitignore"), "node_modules/\n.env*\n").unwrap();
        // Declared a level down, not at the root: a repo is entitled to do this,
        // and a matcher that only reads the root .gitignore cannot see it.
        std::fs::create_dir_all(dir.join("packages/app")).unwrap();
        std::fs::write(dir.join("packages/app/.gitignore"), "vendor/\n").unwrap();
        std::fs::write(dir.join("a.txt"), "hi").unwrap();
        run_git(&path, &["add", "."]).unwrap();
        run_git(&path, &["commit", "-m", "init"]).unwrap();

        std::fs::write(dir.join(".env"), "SECRET=1").unwrap();
        std::fs::write(dir.join(".env.local"), "LOCAL=1").unwrap();
        // A monorepo keeps them a level down too.
        std::fs::create_dir_all(dir.join("packages/app")).unwrap();
        std::fs::write(dir.join("packages/app/.env"), "PKG=1").unwrap();
        // The trap: ignored directories full of other people's files. One is
        // ignored by the root .gitignore, one only by a nested one.
        std::fs::create_dir_all(dir.join("node_modules/foo")).unwrap();
        std::fs::write(dir.join("node_modules/foo/.env"), "NOT_MINE=1").unwrap();
        std::fs::create_dir_all(dir.join("packages/app/vendor/dep")).unwrap();
        std::fs::write(dir.join("packages/app/vendor/dep/.env"), "NOT_MINE=2").unwrap();
        (dir, path)
    }

    #[test]
    fn copy_local_files_carries_gitignored_env_files_into_the_worktree() {
        let (dir, path) = repo_with_ignored_files("wt-copy");
        let dest = dir.join("..").join(format!("{}-dest", dir.file_name().unwrap().to_string_lossy()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();

        let copied = copy_local_files(&path, &dest.to_string_lossy(), &["**/.env*".to_string()]).unwrap();

        // The whole point: `git worktree add` gives tracked source only, so
        // these would not be there and the first command would die on them.
        assert!(dest.join(".env").exists());
        assert_eq!(std::fs::read_to_string(dest.join(".env")).unwrap(), "SECRET=1");
        assert!(dest.join(".env.local").exists());
        assert!(dest.join("packages/app/.env").exists(), "a monorepo keeps them a level down");
        assert_eq!(copied.len(), 3);

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn copy_local_files_does_not_reach_into_an_ignored_directory() {
        let (dir, path) = repo_with_ignored_files("wt-copy-nm");
        let dest = dir.join("..").join(format!("{}-dest", dir.file_name().unwrap().to_string_lossy()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();

        copy_local_files(&path, &dest.to_string_lossy(), &["**/.env*".to_string()]).unwrap();

        // Neither of these is the user's file, and copying either would conjure
        // a dependency tree in a worktree that has none.
        assert!(!dest.join("node_modules").exists());
        // The one the old root-only matcher could not see. `git check-ignore`
        // agrees this is ignored; a hand-rolled matcher reading only the root
        // .gitignore does not.
        assert!(!dest.join("packages/app/vendor").exists());

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn copy_local_files_never_clobbers_a_file_the_worktree_already_has() {
        let (dir, path) = repo_with_ignored_files("wt-copy-keep");
        let dest = dir.join("..").join(format!("{}-dest", dir.file_name().unwrap().to_string_lossy()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(dest.join(".env"), "ALREADY_MINE=1").unwrap();

        let copied = copy_local_files(&path, &dest.to_string_lossy(), &["**/.env*".to_string()]).unwrap();

        assert_eq!(std::fs::read_to_string(dest.join(".env")).unwrap(), "ALREADY_MINE=1");
        assert!(!copied.iter().any(|c| c == ".env"), "an untouched file is not a copied one");

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn copy_local_files_copies_nothing_when_asked_for_nothing() {
        let (dir, path) = repo_with_ignored_files("wt-copy-empty");
        let dest = dir.join("..").join(format!("{}-dest", dir.file_name().unwrap().to_string_lossy()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();

        // An empty glob list is a user who cleared the field. It must mean "copy
        // nothing", never "match everything" — the difference between doing what
        // was asked and copying the entire working tree.
        assert_eq!(copy_local_files(&path, &dest.to_string_lossy(), &[]).unwrap(), Vec::<String>::new());
        assert_eq!(
            copy_local_files(&path, &dest.to_string_lossy(), &["".to_string(), "  ".to_string()]).unwrap(),
            Vec::<String>::new()
        );
        assert!(!dest.join("a.txt").exists());
        assert!(!dest.join(".env").exists());

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn copy_local_files_refuses_a_worktree_nested_in_the_repo() {
        let (dir, path) = repo_with_ignored_files("wt-copy-nested");
        // The walk is rooted at the repo, so a destination inside it is a
        // destination the walk will find and copy from — its own output.
        let inside = dir.join("worktrees/feature");
        std::fs::create_dir_all(&inside).unwrap();

        assert!(copy_local_files(&path, &inside.to_string_lossy(), &["**/.env*".to_string()]).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_local_files_never_leaves_the_repo() {
        let (dir, path) = repo_with_ignored_files("wt-copy-escape");
        let dest = dir.join("..").join(format!("{}-dest", dir.file_name().unwrap().to_string_lossy()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();

        // Assert the property, not the guard. git only ever reports paths inside
        // the repo, so a glob reaching outward matches nothing — whether or not
        // any hand-written check rejects it first.
        assert!(copy_local_files(&path, &dest.to_string_lossy(), &["../**".to_string()]).unwrap().is_empty());
        assert!(copy_local_files(&path, &dest.to_string_lossy(), &["/etc/passwd".to_string()]).unwrap().is_empty());
        assert!(!dest.join("etc").exists());
        assert!(std::fs::read_dir(&dest).unwrap().next().is_none(), "nothing landed at all");

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn copy_local_files_takes_a_glob_with_dots_in_a_real_filename() {
        let (dir, path) = repo_with_ignored_files("wt-copy-dots");
        let dest = dir.join("..").join(format!("{}-dest", dir.file_name().unwrap().to_string_lossy()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(dir.join(".env..bak"), "ODD=1").unwrap();

        // A ".." substring rule would reject this legitimate name. The escape it
        // was guarding against is not reachable in the first place.
        let copied = copy_local_files(&path, &dest.to_string_lossy(), &["**/.env..bak".to_string()]).unwrap();

        assert_eq!(copied, vec![".env..bak".to_string()]);

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn copy_local_files_ignores_the_git_directory_whatever_the_glob_says() {
        let (dir, path) = repo_with_ignored_files("wt-copy-git");
        let dest = dir.join("..").join(format!("{}-dest", dir.file_name().unwrap().to_string_lossy()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();

        copy_local_files(&path, &dest.to_string_lossy(), &["**/*".to_string()]).unwrap();

        // A worktree's .git is a file pointing at the repo. Overwriting it with
        // the repo's own .git directory would detach the worktree from git.
        assert!(!dest.join(".git").exists());

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&dest);
    }

}
