//! Watches Claude Code session transcripts and streams newly appended lines to
//! the frontend, one independent watcher per project directory (cwd). The
//! tailing core (which complete lines were added since we last read) is a pure
//! function so it can be tested without the filesystem or the notify watcher.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, State};

/// Event name carrying a freshly appended batch of transcript lines to the
/// frontend, tagged with the cwd they belong to.
const PROGRESS_EVENT: &str = "claude-progress:lines";

/// Payload emitted to the frontend: which project (cwd) produced these lines.
#[derive(Clone, serde::Serialize)]
struct ProgressBatch {
    cwd: String,
    lines: Vec<String>,
}

/// Splits out the complete lines that appear after `from_offset` (a byte index
/// into `contents`). A trailing line with no newline yet is left unconsumed, so
/// tailing a file mid-write never yields a half-written JSON line. Returns the
/// new lines and the byte offset to resume from next time.
pub fn split_new_lines(contents: &str, from_offset: usize) -> (Vec<String>, usize) {
    let start = if from_offset > contents.len() { 0 } else { from_offset };
    match contents[start..].rfind('\n') {
        Some(idx) => {
            let end = start + idx + 1;
            let lines = contents[start..end].lines().map(str::to_string).collect();
            (lines, end)
        }
        None => (Vec::new(), start),
    }
}

/// Read the file and return the lines appended since `from_offset`. A read error
/// (file missing, mid-rename) yields nothing and leaves the offset untouched.
fn read_new_lines(path: &Path, from_offset: usize) -> (Vec<String>, usize) {
    match std::fs::read_to_string(path) {
        Ok(contents) => split_new_lines(&contents, from_offset),
        Err(_) => (Vec::new(), from_offset),
    }
}

/// Byte length of a file, or 0 if it cannot be read. Used to start tailing at the
/// end of an existing transcript so old history is never replayed.
fn byte_len(path: &Path) -> usize {
    std::fs::read_to_string(path).map_or(0, |contents| contents.len())
}

/// Mangle a working directory into the folder name Claude Code stores its
/// transcripts under (every non-alphanumeric character becomes a dash), e.g.
/// `/Users/me/01.project` -> `-Users-me-01-project`.
fn mangle_cwd(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// The most recently modified `.jsonl` transcript in `dir`, if any.
fn latest_transcript(dir: &Path) -> Option<PathBuf> {
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        if let Ok(modified) = entry.metadata().and_then(|meta| meta.modified()) {
            if newest.as_ref().map_or(true, |(time, _)| modified > *time) {
                newest = Some((modified, path));
            }
        }
    }
    newest.map(|(_, path)| path)
}

/// Which transcript a watcher is tailing and how far it has read. Shared with the
/// notify callback so it can follow the directory's newest session over time.
struct WatchCursor {
    current: Option<PathBuf>,
    offset: usize,
}

/// Build a watcher for one project directory. It follows the directory's newest
/// session: tailing only lines appended from now on, and switching (reading from
/// the start) whenever a newer session file appears. Each emitted batch is
/// tagged with `cwd`.
fn build_watcher(app: &AppHandle, dir: &Path, cwd: String) -> Result<RecommendedWatcher, String> {
    let current = latest_transcript(dir);
    let offset = current.as_deref().map(byte_len).unwrap_or(0);
    let cursor = Arc::new(Mutex::new(WatchCursor { current, offset }));

    let app_cb = app.clone();
    let dir_cb = dir.to_path_buf();
    let cursor_cb = Arc::clone(&cursor);

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_err() {
            return;
        }
        let latest = match latest_transcript(&dir_cb) {
            Some(path) => path,
            None => return,
        };
        let mut cursor = cursor_cb.lock().unwrap();
        if cursor.current.as_ref() != Some(&latest) {
            cursor.current = Some(latest.clone());
            cursor.offset = 0;
        }
        let (lines, new_offset) = read_new_lines(&latest, cursor.offset);
        cursor.offset = new_offset;
        if !lines.is_empty() {
            let _ = app_cb.emit(
                PROGRESS_EVENT,
                ProgressBatch {
                    cwd: cwd.clone(),
                    lines,
                },
            );
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    Ok(watcher)
}

/// Holds one active watcher per watched project directory (keyed by cwd).
/// Dropping a watcher stops its OS-level subscription.
pub struct ClaudeProgressState {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl ClaudeProgressState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for ClaudeProgressState {
    fn default() -> Self {
        Self::new()
    }
}

/// Sync the set of watched project directories to exactly `cwds`: keep existing
/// watchers, drop ones no longer present, and start watching new ones. Directories
/// with no transcript yet are simply skipped (no watcher until a session exists).
#[tauri::command]
pub fn claude_progress_watch(
    app: AppHandle,
    state: State<ClaudeProgressState>,
    cwds: Vec<String>,
) -> Result<(), String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let mut watchers = state.watchers.lock().unwrap();

    watchers.retain(|cwd, _| cwds.contains(cwd));

    for cwd in cwds {
        if watchers.contains_key(&cwd) {
            continue;
        }
        let dir = home.join(".claude").join("projects").join(mangle_cwd(&cwd));
        if !dir.is_dir() {
            continue;
        }
        if let Ok(watcher) = build_watcher(&app, &dir, cwd.clone()) {
            watchers.insert(cwd, watcher);
        }
    }

    Ok(())
}

/// Stop streaming all transcripts.
#[tauri::command]
pub fn claude_progress_unwatch(state: State<ClaudeProgressState>) {
    state.watchers.lock().unwrap().clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_complete_lines_and_leaves_a_partial_line_unconsumed() {
        let (lines, offset) = split_new_lines("a\nb\nc", 0);
        assert_eq!(lines, vec!["a", "b"]);
        assert_eq!(offset, 4);
    }

    #[test]
    fn resumes_from_the_offset_on_the_next_read() {
        let (lines, offset) = split_new_lines("a\nb\nc\nd\n", 4);
        assert_eq!(lines, vec!["c", "d"]);
        assert_eq!(offset, 8);
    }

    #[test]
    fn returns_nothing_when_there_is_no_complete_line_yet() {
        let (lines, offset) = split_new_lines("abc", 0);
        assert!(lines.is_empty());
        assert_eq!(offset, 0);
    }

    #[test]
    fn starting_at_the_end_of_a_file_yields_no_history() {
        let contents = "a\nb\nc\n";
        let (lines, offset) = split_new_lines(contents, contents.len());
        assert!(lines.is_empty());
        assert_eq!(offset, contents.len());
    }

    #[test]
    fn restarts_from_the_top_when_the_file_shrank() {
        let (lines, offset) = split_new_lines("x\n", 100);
        assert_eq!(lines, vec!["x"]);
        assert_eq!(offset, 2);
    }

    #[test]
    fn mangles_a_cwd_into_a_projects_folder_name() {
        assert_eq!(mangle_cwd("/Users/me/01.project"), "-Users-me-01-project");
    }
}
