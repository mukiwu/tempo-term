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

/// A discovered Codex rollout file: its path, last-modified time, and the cwd
/// read from its session_meta line.
pub struct RolloutCandidate {
    pub path: PathBuf,
    pub modified: SystemTime,
    pub cwd: String,
}

/// The newest candidate whose cwd equals `target_cwd`, or None.
pub fn select_newest_for_cwd(candidates: &[RolloutCandidate], target_cwd: &str) -> Option<PathBuf> {
    candidates
        .iter()
        .filter(|c| c.cwd == target_cwd)
        .max_by_key(|c| c.modified)
        .map(|c| c.path.clone())
}

/// The cwd recorded in a Codex rollout's first line. Returns None when the line
/// is not a `session_meta` record or has no cwd.
pub fn parse_session_meta_cwd(first_line: &str) -> Option<String> {
    let value: Value = serde_json::from_str(first_line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    value
        .get("payload")?
        .get("cwd")?
        .as_str()
        .map(str::to_string)
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
            if let Some(cwd) = first_line(&path).as_deref().and_then(parse_session_meta_cwd) {
                out.push(RolloutCandidate { path, modified, cwd });
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{Duration, SystemTime};

    fn write_rollout(dir: &PathBuf, name: &str, cwd: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        let line = format!(r#"{{"type":"session_meta","payload":{{"cwd":"{cwd}"}}}}"#);
        std::fs::write(&path, line + "\n").unwrap();
        path
    }

    #[test]
    fn scans_only_the_given_day_dirs_and_reads_each_cwd() {
        let base = std::env::temp_dir().join(format!("tempoterm-codex-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let day = base.join("2026").join("06").join("22");
        write_rollout(&day, "rollout-a.jsonl", "/proj/x");
        // A file in a day we do not scan must be ignored.
        let other = base.join("2026").join("06").join("01");
        write_rollout(&other, "rollout-b.jsonl", "/proj/y");

        let found = scan_recent_rollouts(&base, &[(2026, 6, 22)]);
        let cwds: Vec<&str> = found.iter().map(|c| c.cwd.as_str()).collect();
        assert!(cwds.contains(&"/proj/x"));
        assert!(!cwds.contains(&"/proj/y"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn reads_cwd_from_a_session_meta_line() {
        let line = r#"{"type":"session_meta","payload":{"id":"x","cwd":"/Users/me/proj","cli_version":"0.140.0"}}"#;
        assert_eq!(parse_session_meta_cwd(line).as_deref(), Some("/Users/me/proj"));
    }

    #[test]
    fn returns_none_for_non_session_meta_or_malformed() {
        assert_eq!(parse_session_meta_cwd(r#"{"type":"event_msg","payload":{}}"#), None);
        assert_eq!(parse_session_meta_cwd("not json"), None);
        assert_eq!(parse_session_meta_cwd(r#"{"type":"session_meta","payload":{}}"#), None);
    }

    #[test]
    fn picks_the_newest_candidate_whose_cwd_matches() {
        let base = SystemTime::UNIX_EPOCH;
        let candidates = vec![
            RolloutCandidate { path: PathBuf::from("/a/old.jsonl"), modified: base, cwd: "/proj".into() },
            RolloutCandidate { path: PathBuf::from("/a/new.jsonl"), modified: base + Duration::from_secs(10), cwd: "/proj".into() },
            RolloutCandidate { path: PathBuf::from("/a/other.jsonl"), modified: base + Duration::from_secs(20), cwd: "/elsewhere".into() },
        ];
        assert_eq!(select_newest_for_cwd(&candidates, "/proj"), Some(PathBuf::from("/a/new.jsonl")));
        assert_eq!(select_newest_for_cwd(&candidates, "/missing"), None);
    }
}
