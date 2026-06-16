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

#[tauri::command]
pub fn git_log(repo_path: String, limit: Option<usize>) -> Result<Vec<CommitInfo>, String> {
    log(&repo_path, limit.unwrap_or(50))
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
}
