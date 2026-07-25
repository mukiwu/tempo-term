//! Watches Codex rollout transcripts and streams newly appended lines to the
//! frontend, tagged with the cwd they belong to. Codex stores sessions under
//! `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, keyed by date not cwd, so the
//! cwd is read from each file's first `session_meta` line.

use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use chrono::{Datelike, Duration as ChronoDuration, Local};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::modules::claude_progress::{byte_len, read_new_lines};

/// A discovered Codex rollout file: its path, last-modified time, and metadata
/// read from its session_meta line.
pub struct RolloutCandidate {
    pub path: PathBuf,
    pub modified: SystemTime,
    pub cwd: String,
    /// The rollout's own thread id from `payload.id`, equal to the filename
    /// UUID; this is not `payload.session_id`, which identifies the root session.
    pub rollout_id: Option<String>,
}

/// The newest candidate whose cwd equals `target_cwd`, or None.
pub fn select_newest_for_cwd(candidates: &[RolloutCandidate], target_cwd: &str) -> Option<PathBuf> {
    candidates
        .iter()
        .filter(|c| c.cwd == target_cwd)
        .max_by_key(|c| c.modified)
        .map(|c| c.path.clone())
}

struct SessionMeta {
    cwd: String,
    rollout_id: Option<String>,
}

/// The cwd and rollout id recorded in a Codex rollout's first line. Returns
/// None when the line is not a `session_meta` record or has no cwd.
fn parse_session_meta(first_line: &str) -> Option<SessionMeta> {
    let value: Value = serde_json::from_str(first_line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    let payload = value.get("payload")?;
    let cwd = payload.get("cwd")?.as_str()?.to_string();
    let rollout_id = payload.get("id").and_then(Value::as_str).map(str::to_string);
    Some(SessionMeta { cwd, rollout_id })
}

/// Longest session title we keep; longer text is truncated for display.
const MAX_TITLE_CHARS: usize = 80;

/// Derive a title for a Codex session from a reader over its rollout JSONL: the
/// first `user_message` event's text, trimmed and truncated. The session opens
/// with injected `response_item` context (environment, instructions); the user's
/// own first turn arrives as an `event_msg`/`user_message`, so that is what we
/// use. Reads lazily and stops at the first match, so a long rollout is not fully
/// loaded. Returns None when the rollout has no user message yet.
pub fn extract_codex_title<R: BufRead>(reader: R) -> Option<String> {
    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("type").and_then(Value::as_str) != Some("event_msg") {
            continue;
        }
        let payload = match value.get("payload") {
            Some(payload) => payload,
            None => continue,
        };
        if payload.get("type").and_then(Value::as_str) != Some("user_message") {
            continue;
        }
        if let Some(text) = payload.get("message").and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.chars().take(MAX_TITLE_CHARS).collect());
            }
        }
    }
    None
}

/// `~/.codex/sessions` (or under the CODEX_HOME override).
pub fn codex_sessions_base(home: &Path) -> PathBuf {
    match std::env::var("CODEX_HOME") {
        Ok(v) if !v.trim().is_empty() => {
            let p = Path::new(&v);
            p.strip_prefix("~").map(|r| home.join(r)).unwrap_or_else(|_| p.to_path_buf()).join("sessions")
        }
        _ => home.join(".codex").join("sessions"),
    }
}

/// Read just the first line of a file (the session_meta), cheaply.
fn first_line(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    Some(line)
}

/// Collect rollout candidates from the given (year, month, day) directories only.
pub fn scan_recent_rollouts(base: &Path, days: &[(i32, u32, u32)]) -> Vec<RolloutCandidate> {
    let mut out = Vec::new();
    for (y, m, d) in days {
        let dir = base.join(format!("{y:04}")).join(format!("{m:02}")).join(format!("{d:02}"));
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let modified = match entry.metadata().and_then(|m| m.modified()) {
                Ok(t) => t,
                Err(_) => continue,
            };
            if let Some(meta) = first_line(&path).as_deref().and_then(parse_session_meta) {
                out.push(RolloutCandidate {
                    path,
                    modified,
                    cwd: meta.cwd,
                    rollout_id: meta.rollout_id,
                });
            }
        }
    }
    out
}

const PROGRESS_EVENT: &str = "claude-progress:lines";

#[derive(Clone, serde::Serialize)]
struct ProgressBatch {
    cwd: String,
    agent: String,
    lines: Vec<String>,
    reset: bool,
}

struct CwdCursor {
    current: Option<PathBuf>,
    offset: usize,
    pending_reset: bool,
}

struct RouteState {
    watched: Vec<String>,
    cursors: HashMap<String, CwdCursor>,
}

pub struct CodexProgressState {
    route: Arc<Mutex<RouteState>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl CodexProgressState {
    pub fn new() -> Self {
        Self {
            route: Arc::new(Mutex::new(RouteState { watched: Vec::new(), cursors: HashMap::new() })),
            watcher: Mutex::new(None),
        }
    }
}

impl Default for CodexProgressState {
    fn default() -> Self {
        Self::new()
    }
}

/// Today and yesterday as (year, month, day) in local time. Both days are
/// returned so an overnight session started yesterday is still found. Codex
/// names its date directories in local time, so this must be local, not UTC.
fn recent_days() -> Vec<(i32, u32, u32)> {
    let today = Local::now().date_naive();
    let yesterday = today - ChronoDuration::days(1);
    vec![
        (today.year(), today.month(), today.day()),
        (yesterday.year(), yesterday.month(), yesterday.day()),
    ]
}

/// (Re)point each watched cwd at its newest current rollout, then rebuild the
/// single recursive watcher on the sessions base. Called whenever the watched
/// set changes.
pub fn set_watched_cwds(app: &AppHandle, state: &CodexProgressState, cwds: &[String]) {
    let home = match app.path().home_dir() {
        Ok(h) => h,
        Err(_) => return,
    };
    let base = codex_sessions_base(&home);
    let candidates = scan_recent_rollouts(&base, &recent_days());

    {
        let mut route = state.route.lock().unwrap();
        route.watched = cwds.to_vec();
        route.cursors.retain(|cwd, _| cwds.contains(cwd));
        // Seed a cursor at the end of each new cwd's newest rollout so history is
        // not replayed. Existing cursors keep their offset.
        for cwd in cwds {
            if !route.cursors.contains_key(cwd) {
                let newest = select_newest_for_cwd(&candidates, cwd);
                let offset = newest.as_deref().map(byte_len).unwrap_or(0);
                route.cursors.insert(
                    cwd.clone(),
                    CwdCursor { current: newest, offset, pending_reset: false },
                );
            }
        }
    }

    // One recursive watcher on the sessions base; the callback reroutes on each event.
    let app_cb = app.clone();
    let base_cb = base.clone();
    let route_cb = Arc::clone(&state.route);
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            route_event(&app_cb, &base_cb, &route_cb, Some(event));
        }
    });
    if let Ok(mut w) = watcher {
        if w.watch(&base, RecursiveMode::Recursive).is_ok() {
            *state.watcher.lock().unwrap() = Some(w);
        }
    }
}

/// On a change under the sessions base: for each watched cwd, find its current
/// rollout, switch (reset) if it changed, then tail appended lines and emit them
/// tagged with agent "codex".
///
/// Scanning the sessions tree (one first-line read per rollout) is only needed
/// when a new file might have appeared: a Create / rename, or a cwd that has no
/// tracked file yet. Plain appends (`Modify(Data)`) just tail the already-tracked
/// file, mirroring how the Claude watcher avoids rescanning on every write.
fn route_event(app: &AppHandle, base: &Path, route: &Arc<Mutex<RouteState>>, event: Option<notify::Event>) {
    let mut route = route.lock().unwrap();
    let watched = route.watched.clone();
    let needs_scan = event.as_ref().map_or(true, |e| {
        matches!(
            e.kind,
            notify::EventKind::Create(_) | notify::EventKind::Modify(notify::event::ModifyKind::Name(_))
        )
    }) || watched
        .iter()
        .any(|cwd| route.cursors.get(cwd).and_then(|c| c.current.as_ref()).is_none());
    let candidates = if needs_scan {
        scan_recent_rollouts(base, &recent_days())
    } else {
        Vec::new()
    };
    for cwd in watched {
        let newest = if needs_scan {
            select_newest_for_cwd(&candidates, &cwd)
        } else {
            route.cursors.get(&cwd).and_then(|c| c.current.clone())
        };
        let cursor = route.cursors.entry(cwd.clone()).or_insert_with(|| CwdCursor {
            current: None,
            offset: 0,
            pending_reset: false,
        });
        if newest.is_some() && cursor.current != newest {
            cursor.current = newest.clone();
            cursor.offset = 0;
            cursor.pending_reset = true;
        }
        let Some(path) = cursor.current.clone() else {
            continue;
        };
        let (lines, new_offset) = match read_new_lines(&path, cursor.offset) {
            Some(r) => r,
            None => {
                cursor.current = None;
                continue;
            }
        };
        cursor.offset = new_offset;
        if !lines.is_empty() {
            let reset = cursor.pending_reset;
            cursor.pending_reset = false;
            let _ = app.emit(
                PROGRESS_EVENT,
                ProgressBatch { cwd: cwd.clone(), agent: "codex".into(), lines, reset },
            );
        }
    }
}

/// Resolve the title for a title request from already-discovered rollout
/// candidates. Kept separate from the Tauri command for focused selection
/// tests. A provided id matches `payload.id` exactly, without cwd filtering
/// or fallback; only an id-less request keeps the legacy newest-for-cwd
/// behavior. First match wins: Codex mints rollout ids as UUIDs, so two
/// candidates sharing one id would mean a corrupted sessions tree.
fn resolve_session_title(
    candidates: &[RolloutCandidate],
    cwd: &str,
    session_id: Option<&str>,
) -> Option<String> {
    let path = match session_id {
        Some(id) => candidates
            .iter()
            .find(|candidate| candidate.rollout_id.as_deref() == Some(id))
            .map(|candidate| candidate.path.clone()),
        None => select_newest_for_cwd(candidates, cwd),
    }?;
    let file = File::open(path).ok()?;
    extract_codex_title(BufReader::new(file))
}

/// The title of the requested Codex session, read from its rollout. A provided
/// id — valid or not — answers for that exact rollout only, never the newest:
/// a just-started titleless session would otherwise wear a concurrent
/// sibling's title (the Claude counterpart of this rule shipped in #233). An
/// id-less request keeps the legacy newest-for-`cwd` behavior.
#[tauri::command]
pub async fn codex_session_title(
    app: AppHandle,
    cwd: String,
    session_id: Option<String>,
) -> Option<String> {
    // Scanning rollouts and parsing the transcript scales with session length;
    // run it on a blocking thread so a long session never freezes the UI.
    tauri::async_runtime::spawn_blocking(move || {
        let home = app.path().home_dir().ok()?;
        let base = codex_sessions_base(&home);
        let candidates = scan_recent_rollouts(&base, &recent_days());
        resolve_session_title(&candidates, &cwd, session_id.as_deref())
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime};

    struct TempBase {
        path: PathBuf,
    }

    impl TempBase {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "tempoterm-codex-{name}-{}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&path);
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempBase {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    struct RolloutSpec<'a> {
        name: &'a str,
        cwd: &'a str,
        rollout_id: Option<&'a str>,
        root_session_id: Option<&'a str>,
        title: &'a str,
    }

    fn write_rollout(dir: &Path, spec: RolloutSpec<'_>) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(spec.name);
        let mut payload = serde_json::json!({ "cwd": spec.cwd });
        if let Some(rollout_id) = spec.rollout_id {
            payload["id"] = Value::String(rollout_id.to_string());
        }
        if let Some(root_session_id) = spec.root_session_id {
            payload["session_id"] = Value::String(root_session_id.to_string());
        }
        let meta = serde_json::json!({ "type": "session_meta", "payload": payload });
        let user_message = serde_json::json!({
            "type": "event_msg",
            "payload": { "type": "user_message", "message": spec.title }
        });
        std::fs::write(&path, format!("{meta}\n{user_message}\n")).unwrap();
        path
    }

    #[test]
    fn scans_only_the_given_day_dirs_and_reads_each_cwd() {
        let base = TempBase::new("scan-days");
        let day = base.path().join("2026").join("06").join("22");
        write_rollout(
            &day,
            RolloutSpec {
                name: "rollout-a.jsonl",
                cwd: "/proj/x",
                rollout_id: Some("a"),
                root_session_id: None,
                title: "A",
            },
        );
        // A file in a day we do not scan must be ignored.
        let other = base.path().join("2026").join("06").join("01");
        write_rollout(
            &other,
            RolloutSpec {
                name: "rollout-b.jsonl",
                cwd: "/proj/y",
                rollout_id: Some("b"),
                root_session_id: None,
                title: "B",
            },
        );

        let found = scan_recent_rollouts(base.path(), &[(2026, 6, 22)]);
        let cwds: Vec<&str> = found.iter().map(|c| c.cwd.as_str()).collect();
        assert!(cwds.contains(&"/proj/x"));
        assert!(!cwds.contains(&"/proj/y"));
    }

    #[test]
    fn reads_cwd_and_rollout_id_from_a_session_meta_line() {
        let line = r#"{"type":"session_meta","payload":{"id":"x","cwd":"/Users/me/proj","cli_version":"0.140.0"}}"#;
        let meta = parse_session_meta(line).unwrap();
        assert_eq!(meta.cwd, "/Users/me/proj");
        assert_eq!(meta.rollout_id.as_deref(), Some("x"));
    }

    #[test]
    fn returns_none_for_non_session_meta_or_malformed() {
        assert!(parse_session_meta(r#"{"type":"event_msg","payload":{}}"#).is_none());
        assert!(parse_session_meta("not json").is_none());
        assert!(parse_session_meta(r#"{"type":"session_meta","payload":{}}"#).is_none());
    }

    #[test]
    fn scan_keeps_rollouts_without_rollout_id_and_parses_payload_ids() {
        let base = TempBase::new("scan-ids");
        let day = base.path().join("2026").join("06").join("22");
        write_rollout(
            &day,
            RolloutSpec {
                name: "rollout-with-id.jsonl",
                cwd: "/proj",
                rollout_id: Some("session-a"),
                root_session_id: None,
                title: "A",
            },
        );
        write_rollout(
            &day,
            RolloutSpec {
                name: "rollout-without-id.jsonl",
                cwd: "/proj",
                rollout_id: None,
                root_session_id: None,
                title: "Legacy",
            },
        );

        let found = scan_recent_rollouts(base.path(), &[(2026, 6, 22)]);
        assert_eq!(found.len(), 2);
        assert!(found.iter().any(|candidate| {
            candidate.path.ends_with("rollout-with-id.jsonl")
                && candidate.rollout_id.as_deref() == Some("session-a")
        }));
        assert!(found.iter().any(|candidate| {
            candidate.path.ends_with("rollout-without-id.jsonl")
                && candidate.rollout_id.is_none()
        }));
    }

    #[test]
    fn picks_the_newest_candidate_whose_cwd_matches() {
        let base = SystemTime::UNIX_EPOCH;
        let candidates = vec![
            RolloutCandidate {
                path: PathBuf::from("/a/old.jsonl"),
                modified: base,
                cwd: "/proj".into(),
                rollout_id: Some("old".into()),
            },
            RolloutCandidate {
                path: PathBuf::from("/a/new.jsonl"),
                modified: base + Duration::from_secs(10),
                cwd: "/proj".into(),
                rollout_id: Some("new".into()),
            },
            RolloutCandidate {
                path: PathBuf::from("/a/other.jsonl"),
                modified: base + Duration::from_secs(20),
                cwd: "/elsewhere".into(),
                rollout_id: Some("other".into()),
            },
        ];
        assert_eq!(select_newest_for_cwd(&candidates, "/proj"), Some(PathBuf::from("/a/new.jsonl")));
        assert_eq!(select_newest_for_cwd(&candidates, "/missing"), None);
    }

    fn two_rollout_candidates(name: &str) -> (TempBase, Vec<RolloutCandidate>) {
        let base = TempBase::new(name);
        let day = base.path().join("2026").join("06").join("22");
        write_rollout(
            &day,
            RolloutSpec {
                name: "rollout-old.jsonl",
                cwd: "/proj",
                rollout_id: Some("session-a"),
                root_session_id: None,
                title: "Old session title",
            },
        );
        write_rollout(
            &day,
            RolloutSpec {
                name: "rollout-new.jsonl",
                cwd: "/proj",
                rollout_id: Some("session-b"),
                root_session_id: None,
                title: "New session title",
            },
        );
        let mut candidates = scan_recent_rollouts(base.path(), &[(2026, 6, 22)]);
        for candidate in &mut candidates {
            candidate.modified = if candidate.rollout_id.as_deref() == Some("session-a") {
                SystemTime::UNIX_EPOCH
            } else {
                SystemTime::UNIX_EPOCH + Duration::from_secs(10)
            };
        }
        (base, candidates)
    }

    #[test]
    fn requested_id_resolves_older_rollout_in_same_cwd() {
        let (_base, candidates) = two_rollout_candidates("resolve-old");

        assert_eq!(
            resolve_session_title(&candidates, "/proj", Some("session-a")).as_deref(),
            Some("Old session title")
        );
    }

    #[test]
    fn missing_requested_id_does_not_fall_back_to_newest() {
        let (_base, candidates) = two_rollout_candidates("resolve-missing");

        assert_eq!(
            resolve_session_title(&candidates, "/proj", Some("missing")),
            None
        );
    }

    #[test]
    fn request_without_id_keeps_newest_for_cwd_behavior() {
        let (_base, candidates) = two_rollout_candidates("resolve-legacy");

        assert_eq!(
            resolve_session_title(&candidates, "/proj", None).as_deref(),
            Some("New session title")
        );
    }

    #[test]
    fn requested_id_never_matches_payload_session_id() {
        let base = TempBase::new("session-id-trap");
        let day = base.path().join("2026").join("06").join("22");
        write_rollout(
            &day,
            RolloutSpec {
                name: "rollout-trap.jsonl",
                cwd: "/proj",
                rollout_id: Some("actual-rollout-id"),
                root_session_id: Some("root-session-id"),
                title: "Wrong subagent title",
            },
        );
        let candidates = scan_recent_rollouts(base.path(), &[(2026, 6, 22)]);

        assert_eq!(
            resolve_session_title(&candidates, "/proj", Some("root-session-id")),
            None
        );
    }

    #[test]
    fn path_like_requested_id_is_a_safe_miss() {
        let (_base, candidates) = two_rollout_candidates("resolve-garbage");

        assert_eq!(
            resolve_session_title(&candidates, "/proj", Some("../x")),
            None
        );
    }

    #[test]
    fn exact_id_match_does_not_filter_by_cwd() {
        let base = TempBase::new("resolve-cross-cwd");
        let day = base.path().join("2026").join("06").join("22");
        write_rollout(
            &day,
            RolloutSpec {
                name: "rollout-cross-cwd.jsonl",
                cwd: "/private/tmp/proj",
                rollout_id: Some("session-a"),
                root_session_id: None,
                title: "Exact id title",
            },
        );
        let candidates = scan_recent_rollouts(base.path(), &[(2026, 6, 22)]);

        assert_eq!(
            resolve_session_title(&candidates, "/tmp/proj", Some("session-a")).as_deref(),
            Some("Exact id title")
        );
    }

    #[test]
    fn title_is_the_first_user_message_text() {
        // A real rollout opens with session_meta and injected context lines; the
        // first thing the user actually typed arrives as an event_msg/user_message.
        let contents = concat!(
            r#"{"type":"session_meta","payload":{"cwd":"/proj"}}"#,
            "\n",
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>noise</environment_context>"}]}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"Fix the flaky test"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"a later message"}}"#,
        );
        assert_eq!(extract_codex_title(contents.as_bytes()).as_deref(), Some("Fix the flaky test"));
    }

    #[test]
    fn title_is_none_without_a_user_message() {
        let contents = concat!(
            r#"{"type":"session_meta","payload":{"cwd":"/proj"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"task_started"}}"#,
        );
        assert_eq!(extract_codex_title(contents.as_bytes()), None);
    }
}
