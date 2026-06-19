//! Watches Claude Code session transcripts and streams newly appended lines to
//! the frontend, one independent watcher per project directory (cwd). The
//! tailing core (which complete lines were added since we last read) is a pure
//! function so it can be tested without the filesystem or the notify watcher.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use notify::event::ModifyKind;
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
    /// True for the first batch of a newly started session, telling the frontend
    /// to clear this cwd's accumulated progress before applying these lines.
    reset: bool,
}

/// Splits out the complete lines that appear after `from_offset` (a byte index
/// into `contents`). A trailing line with no newline yet is left unconsumed, so
/// tailing a file mid-write never yields a half-written JSON line. Returns the
/// new lines and the byte offset to resume from next time.
pub fn split_new_lines(contents: &str, from_offset: usize) -> (Vec<String>, usize) {
    // Fall back to the start if the offset is past the end (file shrank) or lands
    // mid-character (an in-place rewrite changed bytes under a multibyte char),
    // so slicing a &str never panics on a non-char-boundary index.
    let start = if from_offset > contents.len() || !contents.is_char_boundary(from_offset) {
        0
    } else {
        from_offset
    };
    match contents[start..].rfind('\n') {
        Some(idx) => {
            let end = start + idx + 1;
            let lines = contents[start..end].lines().map(str::to_string).collect();
            (lines, end)
        }
        None => (Vec::new(), start),
    }
}

/// Read only the tail appended since `from_offset` and return the complete lines
/// it contains. Seeks straight to the offset instead of reading the whole file,
/// so cost scales with what was appended, not with the session's total size.
///
/// A read error (file missing, mid-rename) yields nothing and leaves the offset
/// untouched. If the offset is past the end (the file shrank or was rewritten),
/// or the tail isn't valid UTF-8 (the seek landed mid-character), we fall back to
/// reading the whole file from the start, matching `split_new_lines`'s recovery.
fn read_new_lines(path: &Path, from_offset: usize) -> (Vec<String>, usize) {
    let len = match std::fs::metadata(path) {
        Ok(meta) => meta.len() as usize,
        Err(_) => return (Vec::new(), from_offset),
    };

    if from_offset > len {
        return read_from_start(path, from_offset);
    }

    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return (Vec::new(), from_offset),
    };
    if file.seek(SeekFrom::Start(from_offset as u64)).is_err() {
        return (Vec::new(), from_offset);
    }
    let mut tail = String::new();
    match file.read_to_string(&mut tail) {
        Ok(_) => {
            let (lines, consumed) = split_new_lines(&tail, 0);
            (lines, from_offset + consumed)
        }
        // Non-UTF-8 tail: the offset landed mid-character (an in-place rewrite),
        // so reparse the whole file from the top instead of dropping bytes.
        Err(_) => read_from_start(path, from_offset),
    }
}

/// Recovery path: read the entire file and re-split from `from_offset`, letting
/// `split_new_lines` clamp an out-of-range or mid-character offset back to 0.
fn read_from_start(path: &Path, from_offset: usize) -> (Vec<String>, usize) {
    match std::fs::read_to_string(path) {
        Ok(contents) => split_new_lines(&contents, from_offset),
        Err(_) => (Vec::new(), from_offset),
    }
}

/// Byte length of a file, or 0 if it cannot be read. Used to start tailing at the
/// end of an existing transcript so old history is never replayed. Reads only the
/// metadata, never the file contents.
fn byte_len(path: &Path) -> usize {
    std::fs::metadata(path).map_or(0, |meta| meta.len() as usize)
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
    /// Set when we switch to a newer session file; carried until the next
    /// non-empty batch so the frontend gets a reset flag even if the switch and
    /// the first new lines land on different filesystem events.
    pending_reset: bool,
}

/// Build a watcher for one project directory. It follows the directory's newest
/// session: tailing only lines appended from now on, and switching (reading from
/// the start) whenever a newer session file appears. Each emitted batch is
/// tagged with `cwd`.
fn build_watcher(app: &AppHandle, dir: &Path, cwd: String) -> Result<RecommendedWatcher, String> {
    let current = latest_transcript(dir);
    let offset = current.as_deref().map(byte_len).unwrap_or(0);
    let cursor = Arc::new(Mutex::new(WatchCursor {
        current,
        offset,
        pending_reset: false,
    }));

    let app_cb = app.clone();
    let dir_cb = dir.to_path_buf();
    let cursor_cb = Arc::clone(&cursor);

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let event = match res {
            Ok(event) => event,
            Err(_) => return,
        };

        let mut cursor = cursor_cb.lock().unwrap();

        // Only rescan the directory when a new session file might have appeared
        // or when we don't yet have one to tail. A new transcript surfaces as a
        // Create, or (on some backends) as a rename into the directory; both are
        // covered. Plain Modify(Data) events just append to the file we're
        // already following, so reusing the stored path avoids walking the whole
        // directory on every write.
        let may_be_new_file = matches!(
            event.kind,
            notify::EventKind::Create(_) | notify::EventKind::Modify(ModifyKind::Name(_))
        );
        if cursor.current.is_none() || may_be_new_file {
            if let Some(latest) = latest_transcript(&dir_cb) {
                if cursor.current.as_ref() != Some(&latest) {
                    cursor.current = Some(latest);
                    cursor.offset = 0;
                    cursor.pending_reset = true;
                }
            }
        }

        let latest = match cursor.current.clone() {
            Some(path) => path,
            None => return,
        };
        let (lines, new_offset) = read_new_lines(&latest, cursor.offset);
        cursor.offset = new_offset;
        if !lines.is_empty() {
            let reset = cursor.pending_reset;
            cursor.pending_reset = false;
            let _ = app_cb.emit(
                PROGRESS_EVENT,
                ProgressBatch {
                    cwd: cwd.clone(),
                    lines,
                    reset,
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

    #[test]
    fn does_not_panic_on_a_non_char_boundary_offset() {
        // "中" is 3 bytes; offset 1 lands mid-character. Must fall back to the
        // start instead of panicking on a non-char-boundary slice.
        let (lines, _) = split_new_lines("中\n", 1);
        assert_eq!(lines, vec!["中"]);
    }

    fn temp_progress_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tempoterm-claude-progress-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn tail_read_returns_only_the_lines_appended_after_the_offset() {
        let dir = temp_progress_dir("tail");
        let path = dir.join("session.jsonl");
        std::fs::write(&path, "a\nb\n").unwrap();

        // Start tailing at the end of the existing file: no history replayed.
        let offset = byte_len(&path);
        assert_eq!(offset, 4);
        let (lines, offset) = read_new_lines(&path, offset);
        assert!(lines.is_empty());

        // Append more lines; only the appended tail comes back.
        std::fs::write(&path, "a\nb\nc\nd\n").unwrap();
        let (lines, offset) = read_new_lines(&path, offset);
        assert_eq!(lines, vec!["c", "d"]);
        assert_eq!(offset, 8);

        // A read from the new offset with nothing appended yields nothing.
        let (lines, _) = read_new_lines(&path, offset);
        assert!(lines.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_read_falls_back_to_the_start_when_the_file_shrank() {
        let dir = temp_progress_dir("shrank");
        let path = dir.join("session.jsonl");
        std::fs::write(&path, "x\n").unwrap();

        // Offset past the end (file was truncated/rewritten) replays from the top.
        let (lines, offset) = read_new_lines(&path, 100);
        assert_eq!(lines, vec!["x"]);
        assert_eq!(offset, 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_read_falls_back_to_the_start_on_a_multibyte_mid_character_offset() {
        // An in-place rewrite can leave the stored offset mid-way through a
        // multibyte char. Seeking there makes read_to_string return non-UTF-8
        // bytes (Err), which must route through the read-from-start recovery
        // instead of dropping bytes or panicking. "中" is 3 bytes; offset 1
        // lands inside it.
        let dir = temp_progress_dir("midchar");
        let path = dir.join("session.jsonl");
        std::fs::write(&path, "中\n").unwrap();

        let (lines, offset) = read_new_lines(&path, 1);
        assert_eq!(lines, vec!["中"]);
        assert_eq!(offset, 4);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn byte_len_uses_metadata_for_the_file_size() {
        let dir = temp_progress_dir("len");
        let path = dir.join("session.jsonl");
        std::fs::write(&path, "中\n").unwrap();
        // "中" is 3 bytes plus the newline.
        assert_eq!(byte_len(&path), 4);
        // A missing file reports length 0.
        assert_eq!(byte_len(&dir.join("missing.jsonl")), 0);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
