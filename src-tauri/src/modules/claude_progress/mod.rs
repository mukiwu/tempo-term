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
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

/// Longest session title we keep; longer text is truncated for display.
const MAX_TITLE_CHARS: usize = 80;

/// Derive a human-readable title for a session from its transcript JSONL, in
/// priority order: the latest structured `custom-title` record (how current
/// Claude Code persists `/rename`), else the latest rename parsed from the
/// `/rename` stdout echo (older transcripts), else the latest `ai-title`
/// record, else the first user text message. Returns trimmed text truncated to
/// MAX_TITLE_CHARS characters, or None when no source exists. The rename
/// sources are preferred because they carry the user's explicit intent; the
/// other two are the fallback when they never renamed.
pub fn extract_session_title(contents: &str) -> Option<String> {
    let mut custom_title: Option<String> = None;
    let mut renamed: Option<String> = None;
    let mut ai_title: Option<String> = None;
    let mut first_user: Option<String> = None;
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        match value.get("type").and_then(Value::as_str) {
            // Current Claude Code writes `/rename` as a structured record
            // ({"type":"custom-title","customTitle":"NAME",...}). The sessionId
            // field is ignored: the transcript is already per-session. Latest wins;
            // a blank customTitle counts as absent so it can't shadow the fallbacks.
            Some("custom-title") => {
                if let Some(title) = value
                    .get("customTitle")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|title| !title.is_empty())
                {
                    custom_title = Some(title.to_string());
                }
            }
            Some("ai-title") => {
                if let Some(title) = value.get("aiTitle").and_then(Value::as_str) {
                    ai_title = Some(title.to_string());
                }
            }
            // `/rename` is echoed into the transcript as a local-command result
            // ("<local-command-stdout>Session renamed to: NAME</local-command-stdout>").
            // Restrict to `local_command` so an unrelated system line that merely
            // quotes the phrase can't be mistaken for a rename. Latest one wins.
            Some("system")
                if value.get("subtype").and_then(Value::as_str) == Some("local_command") =>
            {
                if let Some(name) = value
                    .get("content")
                    .and_then(Value::as_str)
                    .and_then(parse_renamed_name)
                {
                    renamed = Some(name);
                }
            }
            Some("user") if first_user.is_none() => {
                first_user = user_message_text(&value);
            }
            _ => {}
        }
    }
    let raw = custom_title.or(renamed).or(ai_title).or(first_user)?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(MAX_TITLE_CHARS).collect())
}

/// Extract the name from a Claude Code `/rename` local-command output string,
/// e.g. "<local-command-stdout>Session renamed to: my-name</local-command-stdout>"
/// -> "my-name". None when the marker is absent or the name is empty.
fn parse_renamed_name(content: &str) -> Option<String> {
    const MARKER: &str = "Session renamed to: ";
    let start = content.rfind(MARKER)? + MARKER.len();
    let rest = &content[start..];
    let end = rest.find("</local-command-stdout>").unwrap_or(rest.len());
    // Only the first line: guards against trailing hooks/prompt output that some
    // shells append after the rename notice.
    let name = rest[..end].lines().next().unwrap_or("").trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// The text of a user message whose content is a plain string or a list holding
/// a text item; None for tool-result-only messages.
fn user_message_text(value: &Value) -> Option<String> {
    let content = value.get("message")?.get("content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    for item in content.as_array()? {
        if item.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                return Some(text.to_string());
            }
        }
    }
    None
}

/// The title of the newest transcript in `dir`, read from disk, or None.
pub fn latest_session_title(dir: &Path) -> Option<String> {
    let path = latest_transcript(dir)?;
    let contents = std::fs::read_to_string(path).ok()?;
    extract_session_title(&contents)
}

/// Event name carrying a freshly appended batch of transcript lines to the
/// frontend, tagged with the cwd they belong to.
const PROGRESS_EVENT: &str = "claude-progress:lines";

/// Payload emitted to the frontend: which project (cwd) produced these lines.
#[derive(Clone, serde::Serialize)]
struct ProgressBatch {
    cwd: String,
    agent: String,
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
pub(crate) fn read_new_lines(path: &Path, from_offset: usize) -> Option<(Vec<String>, usize)> {
    let len = match std::fs::metadata(path) {
        Ok(meta) => meta.len() as usize,
        // The tracked file is gone (deleted/rotated): signal so the caller can
        // clear its cursor and rescan instead of getting stuck on a dead path.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
        Err(_) => return Some((Vec::new(), from_offset)),
    };

    if from_offset > len {
        return Some(read_from_start(path, from_offset));
    }

    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
        Err(_) => return Some((Vec::new(), from_offset)),
    };
    if file.seek(SeekFrom::Start(from_offset as u64)).is_err() {
        return Some((Vec::new(), from_offset));
    }
    let mut tail = String::new();
    match file.read_to_string(&mut tail) {
        Ok(_) => {
            let (lines, consumed) = split_new_lines(&tail, 0);
            Some((lines, from_offset + consumed))
        }
        // Non-UTF-8 tail: the offset landed mid-character (an in-place rewrite),
        // so reparse the whole file from the top instead of dropping bytes.
        Err(_) => Some(read_from_start(path, from_offset)),
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
pub(crate) fn byte_len(path: &Path) -> usize {
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

/// The base config directory Claude Code writes transcripts under: the
/// `CLAUDE_CONFIG_DIR` override when set and non-empty, otherwise `~/.claude`.
/// A leading `~` in the override is expanded against `home`; shells usually
/// expand it first, but a literal `~` can still reach us from a config file.
pub fn config_base_dir(home: &Path, env_value: Option<&str>) -> PathBuf {
    match env_value {
        Some(value) if !value.trim().is_empty() => {
            let path = Path::new(value);
            match path.strip_prefix("~") {
                Ok(rest) => home.join(rest),
                Err(_) => path.to_path_buf(),
            }
        }
        _ => home.join(".claude"),
    }
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
        let (lines, new_offset) = match read_new_lines(&latest, cursor.offset) {
            Some(result) => result,
            // The tracked file vanished; drop it so the next event rescans the
            // directory and picks up the new session.
            None => {
                cursor.current = None;
                return;
            }
        };
        cursor.offset = new_offset;
        if !lines.is_empty() {
            let reset = cursor.pending_reset;
            cursor.pending_reset = false;
            let _ = app_cb.emit(
                PROGRESS_EVENT,
                ProgressBatch {
                    cwd: cwd.clone(),
                    agent: "claude".into(),
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
/// Also (re)points the Codex watcher at the same cwd set.
#[tauri::command]
pub fn claude_progress_watch(
    app: AppHandle,
    state: State<ClaudeProgressState>,
    codex: State<crate::modules::codex_progress::CodexProgressState>,
    cwds: Vec<String>,
) -> Result<(), String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let env_value = std::env::var("CLAUDE_CONFIG_DIR").ok();
    let base = config_base_dir(&home, env_value.as_deref());
    let mut watchers = state.watchers.lock().unwrap();

    // Drive the Codex watcher before the loop consumes `cwds`.
    crate::modules::codex_progress::set_watched_cwds(&app, &codex, &cwds);

    watchers.retain(|cwd, _| cwds.contains(cwd));

    for cwd in cwds {
        if watchers.contains_key(&cwd) {
            continue;
        }
        let dir = base.join("projects").join(mangle_cwd(&cwd));
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

/// The title of the newest Claude session for `cwd`, derived from its
/// transcript. Returns None when the project has no transcript yet.
#[tauri::command]
pub async fn claude_session_title(app: AppHandle, cwd: String) -> Option<String> {
    // Reading and JSON-parsing the whole transcript scales with session length;
    // run it on a blocking thread so a long session never freezes the UI. This is
    // the main-thread work that grew with transcript size (see fonts_report).
    tauri::async_runtime::spawn_blocking(move || {
        let home = app.path().home_dir().ok()?;
        let env_value = std::env::var("CLAUDE_CONFIG_DIR").ok();
        let base = config_base_dir(&home, env_value.as_deref());
        let dir = base.join("projects").join(mangle_cwd(&cwd));
        if !dir.is_dir() {
            return None;
        }
        latest_session_title(&dir)
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_prefers_the_latest_ai_title() {
        let contents = concat!(
            r#"{"type":"user","message":{"content":[{"type":"text","text":"do a thing"}]}}"#,
            "\n",
            r#"{"type":"ai-title","aiTitle":"First title"}"#,
            "\n",
            r#"{"type":"ai-title","aiTitle":"Refined title"}"#,
            "\n",
        );
        assert_eq!(extract_session_title(contents).as_deref(), Some("Refined title"));
    }

    #[test]
    fn title_prefers_the_rename_over_ai_title_and_first_message() {
        let contents = concat!(
            r#"{"type":"user","message":{"content":[{"type":"text","text":"do a thing"}]}}"#,
            "\n",
            r#"{"type":"ai-title","aiTitle":"Auto title"}"#,
            "\n",
            r#"{"type":"system","subtype":"local_command","content":"<local-command-stdout>Session renamed to: old-name</local-command-stdout>"}"#,
            "\n",
            r#"{"type":"system","subtype":"local_command","content":"<local-command-stdout>Session renamed to: my-feature</local-command-stdout>"}"#,
            "\n",
        );
        // Latest /rename wins over the auto ai-title and the first message.
        assert_eq!(extract_session_title(contents).as_deref(), Some("my-feature"));
    }

    #[test]
    fn title_prefers_the_latest_custom_title_record() {
        // Mixed old/new transcript: the structured custom-title record beats the
        // stdout-parsed rename, the ai-title, and the first message; latest wins.
        let contents = concat!(
            r#"{"type":"user","message":{"content":[{"type":"text","text":"do a thing"}]}}"#,
            "\n",
            r#"{"type":"ai-title","aiTitle":"Auto title"}"#,
            "\n",
            r#"{"type":"custom-title","customTitle":"first-name","sessionId":"abc"}"#,
            "\n",
            r#"{"type":"system","subtype":"local_command","content":"<local-command-stdout>Session renamed to: stdout-name</local-command-stdout>"}"#,
            "\n",
            r#"{"type":"custom-title","customTitle":"final-name","sessionId":"abc"}"#,
            "\n",
        );
        assert_eq!(extract_session_title(contents).as_deref(), Some("final-name"));
    }

    #[test]
    fn blank_custom_title_is_treated_as_absent() {
        // A whitespace-only customTitle must not shadow the fallback chain.
        let contents = concat!(
            r#"{"type":"custom-title","customTitle":"   ","sessionId":"abc"}"#,
            "\n",
            r#"{"type":"system","subtype":"local_command","content":"<local-command-stdout>Session renamed to: stdout-name</local-command-stdout>"}"#,
            "\n",
        );
        assert_eq!(extract_session_title(contents).as_deref(), Some("stdout-name"));
    }

    #[test]
    fn malformed_custom_title_records_are_treated_as_absent() {
        // Missing key or a non-string value must fall through, not panic or win.
        let contents = concat!(
            r#"{"type":"custom-title","sessionId":"abc"}"#,
            "\n",
            r#"{"type":"custom-title","customTitle":42,"sessionId":"abc"}"#,
            "\n",
            r#"{"type":"custom-title","customTitle":null,"sessionId":"abc"}"#,
            "\n",
            r#"{"type":"ai-title","aiTitle":"Auto title"}"#,
            "\n",
        );
        assert_eq!(extract_session_title(contents).as_deref(), Some("Auto title"));
    }

    #[test]
    fn title_falls_back_when_no_rename_present() {
        // A system line that is not a rename must not break the ai-title fallback.
        let contents = concat!(
            r#"{"type":"system","subtype":"local_command","content":"<local-command-stdout>something else</local-command-stdout>"}"#,
            "\n",
            r#"{"type":"ai-title","aiTitle":"Auto title"}"#,
            "\n",
        );
        assert_eq!(extract_session_title(contents).as_deref(), Some("Auto title"));
    }

    #[test]
    fn parse_renamed_name_extracts_and_guards_empty() {
        assert_eq!(
            parse_renamed_name("<local-command-stdout>Session renamed to: abc</local-command-stdout>").as_deref(),
            Some("abc"),
        );
        assert_eq!(parse_renamed_name("Session renamed to: bare-name").as_deref(), Some("bare-name"));
        assert_eq!(parse_renamed_name("no marker here"), None);
        assert_eq!(
            parse_renamed_name("<local-command-stdout>Session renamed to: </local-command-stdout>"),
            None,
        );
        // Trailing hook/prompt output after the name is dropped (first line only).
        assert_eq!(
            parse_renamed_name("Session renamed to: my-name\nhook: did a thing\n$ ").as_deref(),
            Some("my-name"),
        );
    }

    #[test]
    fn rename_only_counts_local_command_system_lines() {
        // A system line that quotes the phrase but is NOT a local_command must be
        // ignored, so the title falls back rather than mis-reading it as a rename.
        let contents = concat!(
            r#"{"type":"system","subtype":"info","content":"note: Session renamed to: not-a-real-rename"}"#,
            "\n",
            r#"{"type":"ai-title","aiTitle":"Auto title"}"#,
            "\n",
        );
        assert_eq!(extract_session_title(contents).as_deref(), Some("Auto title"));
    }

    #[test]
    fn title_falls_back_to_first_user_text_in_a_list() {
        let contents = concat!(
            r#"{"type":"system","subtype":"x"}"#,
            "\n",
            r#"{"type":"user","message":{"content":[{"type":"text","text":"the first prompt"}]}}"#,
            "\n",
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1"}]}}"#,
            "\n",
        );
        assert_eq!(extract_session_title(contents).as_deref(), Some("the first prompt"));
    }

    #[test]
    fn title_falls_back_to_a_plain_string_user_message() {
        let contents = r#"{"type":"user","message":{"content":"plain prompt"}}"#;
        assert_eq!(extract_session_title(contents).as_deref(), Some("plain prompt"));
    }

    #[test]
    fn title_trims_and_truncates_long_text() {
        let long = "x".repeat(200);
        let contents = format!(r#"{{"type":"ai-title","aiTitle":"  {long}  "}}"#);
        let title = extract_session_title(&contents).unwrap();
        assert_eq!(title.chars().count(), 80);
    }

    #[test]
    fn title_is_none_without_usable_content() {
        let contents = concat!(
            r#"{"type":"system","subtype":"x"}"#,
            "\n",
            "not json at all",
            "\n",
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1"}]}}"#,
            "\n",
        );
        assert_eq!(extract_session_title(contents), None);
    }

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
        let (lines, offset) = read_new_lines(&path, offset).unwrap();
        assert!(lines.is_empty());

        // Append more lines; only the appended tail comes back.
        std::fs::write(&path, "a\nb\nc\nd\n").unwrap();
        let (lines, offset) = read_new_lines(&path, offset).unwrap();
        assert_eq!(lines, vec!["c", "d"]);
        assert_eq!(offset, 8);

        // A read from the new offset with nothing appended yields nothing.
        let (lines, _) = read_new_lines(&path, offset).unwrap();
        assert!(lines.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_read_falls_back_to_the_start_when_the_file_shrank() {
        let dir = temp_progress_dir("shrank");
        let path = dir.join("session.jsonl");
        std::fs::write(&path, "x\n").unwrap();

        // Offset past the end (file was truncated/rewritten) replays from the top.
        let (lines, offset) = read_new_lines(&path, 100).unwrap();
        assert_eq!(lines, vec!["x"]);
        assert_eq!(offset, 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_read_signals_a_missing_file_so_the_watcher_can_recover() {
        // If the tracked transcript is deleted or rotated away, the read must
        // report the file is gone (None) so the watcher can clear its cursor and
        // rescan for the new session instead of getting stuck on a dead path.
        let dir = temp_progress_dir("deleted");
        let path = dir.join("session.jsonl");
        std::fs::write(&path, "a\n").unwrap();
        assert!(read_new_lines(&path, 0).is_some());

        std::fs::remove_file(&path).unwrap();
        assert!(read_new_lines(&path, 0).is_none());

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

        let (lines, offset) = read_new_lines(&path, 1).unwrap();
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

    #[test]
    fn config_base_dir_uses_env_override_when_set() {
        let home = Path::new("/home/u");
        assert_eq!(
            config_base_dir(home, Some("/custom/cc")),
            PathBuf::from("/custom/cc")
        );
    }

    #[test]
    fn config_base_dir_falls_back_to_dot_claude_when_unset_or_blank() {
        let home = Path::new("/home/u");
        assert_eq!(config_base_dir(home, None), PathBuf::from("/home/u/.claude"));
        assert_eq!(config_base_dir(home, Some("  ")), PathBuf::from("/home/u/.claude"));
    }

    #[test]
    fn config_base_dir_expands_a_leading_tilde_against_home() {
        let home = Path::new("/home/u");
        assert_eq!(
            config_base_dir(home, Some("~/.claude_custom")),
            PathBuf::from("/home/u/.claude_custom")
        );
    }
}
