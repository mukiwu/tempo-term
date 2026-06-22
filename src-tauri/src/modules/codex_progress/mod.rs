//! Watches Codex rollout transcripts and streams newly appended lines to the
//! frontend, tagged with the cwd they belong to. Codex stores sessions under
//! `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, keyed by date not cwd, so the
//! cwd is read from each file's first `session_meta` line.

use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

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
