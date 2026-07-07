//! Claude Code JSONL parser: walks the uuid/parentUuid DAG's main path and
//! produces session metadata and viewer transcripts. Ported (simplified) from
//! agentsview's claude parser (MIT); see the design spec for the rules.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use chrono::{DateTime, Datelike, Local, Timelike};
use serde_json::Value;

use super::types::{ActivityBucket, ParsedSession, TranscriptMessage};

/// A fork whose first child's subtree holds this many user turns or fewer is
/// treated as an abandoned attempt: the walk takes the last (retry) child
/// instead of the first.
const FORK_USER_TURN_THRESHOLD: usize = 3;

pub(crate) fn epoch_ms(iso: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(iso).ok().map(|t| t.timestamp_millis())
}

/// Local calendar bucket for an epoch-ms timestamp: ("YYYY-MM-DD", hour).
pub(crate) fn local_bucket(ms: i64) -> (String, u8) {
    let local = DateTime::from_timestamp_millis(ms)
        .map(|utc| utc.with_timezone(&Local))
        .unwrap_or_else(Local::now);
    (
        format!("{:04}-{:02}-{:02}", local.year(), local.month(), local.day()),
        local.hour() as u8,
    )
}

/// One parsed JSONL line, with its DAG identity pulled out for convenience.
struct Entry {
    uuid: Option<String>,
    parent: Option<String>,
    value: Value,
}

/// Parse every line into an `Entry`, silently dropping lines that aren't valid
/// JSON. Blank lines are ignored too. Never panics on malformed input.
fn parse_entries(contents: &str) -> Vec<Entry> {
    contents
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let value: Value = serde_json::from_str(line).ok()?;
            let uuid = value.get("uuid").and_then(Value::as_str).map(str::to_string);
            let parent = value.get("parentUuid").and_then(Value::as_str).map(str::to_string);
            Some(Entry { uuid, parent, value })
        })
        .collect()
}

/// A line counts as a message when it's a `user`/`assistant` line, isn't a
/// meta or sidechain line, and carries non-empty message content. A `user`
/// line whose content is only `tool_result` items (no text) doesn't count —
/// it's plumbing, not a conversational turn.
fn is_countable(value: &Value) -> bool {
    let type_ = value.get("type").and_then(Value::as_str);
    let is_user = type_ == Some("user");
    let is_assistant = type_ == Some("assistant");
    if !is_user && !is_assistant {
        return false;
    }
    if value.get("isMeta").and_then(Value::as_bool).unwrap_or(false) {
        return false;
    }
    if value.get("isSidechain").and_then(Value::as_bool).unwrap_or(false) {
        return false;
    }
    let content = match value.get("message").and_then(|m| m.get("content")) {
        Some(c) => c,
        None => return false,
    };
    let non_empty = match content {
        Value::String(s) => !s.trim().is_empty(),
        Value::Array(items) => !items.is_empty(),
        _ => false,
    };
    if !non_empty {
        return false;
    }
    if is_user {
        if let Value::Array(items) = content {
            let only_tool_result = items
                .iter()
                .all(|item| item.get("type").and_then(Value::as_str) == Some("tool_result"));
            if only_tool_result {
                return false;
            }
        }
    }
    true
}

/// Classifies a user turn's text as a harness injection rather than the
/// user's own words, returning the source tag the viewer shows on the
/// collapsed card. Claude Code records teammate messages, system reminders,
/// background task notifications, and slash-command envelopes all as
/// `type: "user"` turns; labelling them "user" in the viewer is misleading
/// and counting them inflates user_message_count.
fn injected_source(text: &str) -> Option<&'static str> {
    let t = text.trim_start();
    if t.starts_with("<teammate-message") || t.starts_with("Another Claude session sent a message:") {
        Some("teammate")
    } else if t.starts_with("<system-reminder>") {
        Some("system-reminder")
    } else if t.starts_with("<task-notification>") {
        Some("task-notification")
    } else if t.starts_with("<local-command-caveat>") || t.starts_with("<command-name>") {
        Some("command")
    } else {
        None
    }
}

/// DFS count of countable `user` entries in the subtree rooted at `i`
/// (inclusive). Guards against cyclic parent data so malformed input can
/// never hang the walk.
fn user_turns_under(entries: &[Entry], children: &HashMap<&str, Vec<usize>>, i: usize) -> usize {
    let mut count = 0;
    let mut stack = vec![i];
    let mut visited: HashSet<usize> = HashSet::new();
    while let Some(idx) = stack.pop() {
        if !visited.insert(idx) {
            continue;
        }
        let entry = &entries[idx];
        if entry.value.get("type").and_then(Value::as_str) == Some("user") && is_countable(&entry.value) {
            count += 1;
        }
        if let Some(uuid) = &entry.uuid {
            if let Some(kids) = children.get(uuid.as_str()) {
                stack.extend(kids.iter().copied());
            }
        }
    }
    count
}

/// The indices (in file order) of the entries that make up the session's main
/// conversational path. Walks the uuid/parentUuid DAG from the first root; at
/// each fork, follows the last child unless the first child's subtree already
/// holds more than `FORK_USER_TURN_THRESHOLD` user turns, treating a
/// short-lived first attempt as an abandoned retry. Falls back to file order
/// when any countable line lacks a `uuid` (the DAG can't be trusted).
fn main_path(entries: &[Entry]) -> Vec<usize> {
    if entries.iter().any(|e| is_countable(&e.value) && e.uuid.is_none()) {
        return (0..entries.len()).collect();
    }

    let mut uuid_index: HashMap<&str, usize> = HashMap::new();
    for (i, e) in entries.iter().enumerate() {
        if let Some(uuid) = &e.uuid {
            uuid_index.insert(uuid.as_str(), i);
        }
    }

    let mut children: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, e) in entries.iter().enumerate() {
        if let Some(parent) = &e.parent {
            if uuid_index.contains_key(parent.as_str()) {
                children.entry(parent.as_str()).or_default().push(i);
            }
        }
    }

    // A root must itself have a uuid (so children can be looked up from it).
    // Real transcripts interleave house-keeping records (mode, last-prompt,
    // hook attachments...) that carry no `uuid`/`parentUuid` at all; those
    // aren't DAG nodes and must never be mistaken for the conversation root.
    let root = entries.iter().position(|e| {
        e.uuid.is_some()
            && match &e.parent {
                None => true,
                Some(parent) => !uuid_index.contains_key(parent.as_str()),
            }
    });
    let Some(root_idx) = root else {
        return (0..entries.len()).collect();
    };

    let mut path = Vec::new();
    let mut visited: HashSet<usize> = HashSet::new();
    let mut current = root_idx;
    loop {
        if !visited.insert(current) {
            break; // cyclic parent data; stop rather than loop forever
        }
        path.push(current);
        let uuid = match &entries[current].uuid {
            Some(uuid) => uuid.as_str(),
            None => break,
        };
        let kids = match children.get(uuid) {
            Some(kids) if !kids.is_empty() => kids,
            _ => break,
        };
        current = if kids.len() == 1 {
            kids[0]
        } else {
            let first = kids[0];
            let last = *kids.last().expect("fork has at least one child");
            if user_turns_under(entries, &children, first) <= FORK_USER_TURN_THRESHOLD {
                last
            } else {
                first
            }
        };
    }
    path
}

/// Parse a Claude Code session transcript into index metadata, or `None` when
/// the file is empty, unreadable, or has no countable messages.
pub fn parse_claude_meta(path: &Path) -> Option<ParsedSession> {
    let contents = std::fs::read_to_string(path).ok()?;
    let entries = parse_entries(&contents);
    if entries.is_empty() {
        return None;
    }
    let main = main_path(&entries);

    let mut message_count: i64 = 0;
    let mut user_message_count: i64 = 0;
    let mut output_tokens: Option<i64> = None;
    let mut model: Option<String> = None;
    let mut buckets: HashMap<(String, u8), ActivityBucket> = HashMap::new();

    for &i in &main {
        let entry = &entries[i];
        if !is_countable(&entry.value) {
            continue;
        }
        // Injected harness turns (teammate messages, reminders, …) are still
        // messages, but they are not the user speaking.
        let is_user = entry.value.get("type").and_then(Value::as_str) == Some("user")
            && entry
                .value
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(user_text_from_content)
                .map_or(true, |text| injected_source(&text).is_none());
        message_count += 1;
        if is_user {
            user_message_count += 1;
        }

        let tokens = entry
            .value
            .get("message")
            .and_then(|m| m.get("usage"))
            .and_then(|u| u.get("output_tokens"))
            .and_then(Value::as_i64);
        if let Some(tokens) = tokens {
            // Saturate rather than overflow on absurd token counts from
            // corrupt files.
            let total = output_tokens.get_or_insert(0);
            *total = total.saturating_add(tokens);
        }
        if !is_user {
            if let Some(m) = entry.value.get("message").and_then(|m| m.get("model")).and_then(Value::as_str) {
                model = Some(m.to_string());
            }
        }

        if let Some(ts) = entry.value.get("timestamp").and_then(Value::as_str).and_then(epoch_ms) {
            let (date, hour) = local_bucket(ts);
            let bucket = buckets.entry((date.clone(), hour)).or_insert_with(|| ActivityBucket {
                date,
                hour,
                messages: 0,
                user_messages: 0,
                output_tokens: 0,
            });
            bucket.messages += 1;
            if is_user {
                bucket.user_messages += 1;
            }
            if let Some(tokens) = tokens {
                bucket.output_tokens = bucket.output_tokens.saturating_add(tokens);
            }
        }
    }

    if message_count == 0 {
        return None;
    }

    // Timestamps span every line in the file, even ones skipped as
    // non-countable (meta/sidechain/tool-result-only), so the session's
    // start/end reflects real wall-clock activity.
    let mut started_at = i64::MAX;
    let mut ended_at = i64::MIN;
    for entry in &entries {
        if let Some(ts) = entry.value.get("timestamp").and_then(Value::as_str).and_then(epoch_ms) {
            started_at = started_at.min(ts);
            ended_at = ended_at.max(ts);
        }
    }
    if started_at > ended_at {
        started_at = 0;
        ended_at = 0;
    }

    // First NON-EMPTY value wins; a present-but-empty field on an early line
    // must not short-circuit the search.
    let id = entries
        .iter()
        .filter_map(|e| e.value.get("sessionId").and_then(Value::as_str))
        .find(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default());

    let project_cwd = entries
        .iter()
        .filter_map(|e| e.value.get("cwd").and_then(Value::as_str))
        .find(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            path.parent()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        });

    let title = crate::modules::claude_progress::extract_session_title(&contents).unwrap_or_default();

    let mut activity: Vec<ActivityBucket> = buckets.into_values().collect();
    activity.sort_by(|a, b| (a.date.as_str(), a.hour).cmp(&(b.date.as_str(), b.hour)));

    Some(ParsedSession {
        id,
        agent: "claude",
        project_cwd,
        title,
        started_at,
        ended_at,
        message_count,
        user_message_count,
        output_tokens,
        model,
        activity,
    })
}

/// The text of a `user` message's content: the plain string, or its `text`
/// items joined with `\n`. `None` when there's no text at all (e.g. a
/// tool-result-only user line).
fn user_text_from_content(content: &Value) -> Option<String> {
    match content {
        Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
        Value::Array(items) => {
            let texts: Vec<&str> = items
                .iter()
                .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect();
            if texts.is_empty() {
                None
            } else {
                Some(texts.join("\n"))
            }
        }
        _ => None,
    }
}

const TOOL_INPUT_PREVIEW_CHARS: usize = 400;

/// Parse a Claude Code session transcript into the viewer's message list,
/// re-derived from the source file on demand. Empty on any read/parse
/// failure — the viewer just shows nothing rather than panicking.
pub fn parse_claude_transcript(path: &Path) -> Vec<TranscriptMessage> {
    let contents = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let entries = parse_entries(&contents);
    if entries.is_empty() {
        return Vec::new();
    }
    let main = main_path(&entries);

    let mut out = Vec::new();
    for &i in &main {
        let entry = &entries[i];
        // Same skip rules as the meta pass: meta/sidechain lines and
        // tool_result-only user lines never render in the viewer, even when
        // they sit on the main path.
        if !is_countable(&entry.value) {
            continue;
        }
        let type_ = entry.value.get("type").and_then(Value::as_str).unwrap_or("");
        let timestamp = entry.value.get("timestamp").and_then(Value::as_str).and_then(epoch_ms);
        let content = match entry.value.get("message").and_then(|m| m.get("content")) {
            Some(c) => c,
            None => continue,
        };

        match type_ {
            "user" => {
                if let Some(text) = user_text_from_content(content) {
                    match injected_source(&text) {
                        Some(source) => out.push(TranscriptMessage {
                            role: "injected".to_string(),
                            text,
                            timestamp,
                            tool_name: Some(source.to_string()),
                        }),
                        None => out.push(TranscriptMessage {
                            role: "user".to_string(),
                            text,
                            timestamp,
                            tool_name: None,
                        }),
                    }
                }
            }
            "assistant" => match content {
                Value::Array(items) => {
                    for item in items {
                        match item.get("type").and_then(Value::as_str) {
                            Some("text") => {
                                if let Some(text) = item.get("text").and_then(Value::as_str) {
                                    out.push(TranscriptMessage {
                                        role: "assistant".to_string(),
                                        text: text.to_string(),
                                        timestamp,
                                        tool_name: None,
                                    });
                                }
                            }
                            Some("tool_use") => {
                                let name = item.get("name").and_then(Value::as_str).unwrap_or("tool").to_string();
                                let input = item.get("input").cloned().unwrap_or(Value::Null);
                                let text: String = serde_json::to_string(&input)
                                    .unwrap_or_default()
                                    .chars()
                                    .take(TOOL_INPUT_PREVIEW_CHARS)
                                    .collect();
                                out.push(TranscriptMessage {
                                    role: "tool".to_string(),
                                    text,
                                    timestamp,
                                    tool_name: Some(name),
                                });
                            }
                            _ => {}
                        }
                    }
                }
                Value::String(s) if !s.trim().is_empty() => {
                    out.push(TranscriptMessage {
                        role: "assistant".to_string(),
                        text: s.clone(),
                        timestamp,
                        tool_name: None,
                    });
                }
                _ => {}
            },
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_fixture(tag: &str, contents: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tt-claude-parse-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("abc-session.jsonl");
        std::fs::write(&path, contents).unwrap();
        path
    }

    const BASIC: &str = concat!(
        r#"{"type":"user","uuid":"u1","parentUuid":null,"sessionId":"sess-1","cwd":"/p/alpha","timestamp":"2026-07-06T01:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}"#, "\n",
        r#"{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"sess-1","timestamp":"2026-07-06T01:00:05.000Z","message":{"role":"assistant","model":"claude-sonnet-5","content":[{"type":"text","text":"hi"}],"usage":{"output_tokens":7}}}"#, "\n",
        r#"{"type":"user","uuid":"u2","parentUuid":"a1","isMeta":true,"timestamp":"2026-07-06T01:00:06.000Z","message":{"role":"user","content":[{"type":"text","text":"meta noise"}]}}"#, "\n",
        r#"{"type":"user","uuid":"u3","parentUuid":"a1","timestamp":"2026-07-06T01:01:00.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1"}]}}"#, "\n",
        r#"{"type":"assistant","uuid":"a2","parentUuid":"u3","timestamp":"2026-07-06T01:02:00.000Z","message":{"role":"assistant","model":"claude-sonnet-5","content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}},{"type":"text","text":"done"}],"usage":{"output_tokens":13}}}"#, "\n",
    );

    #[test]
    fn meta_counts_titles_and_tokens() {
        let path = write_fixture("basic", BASIC);
        let meta = parse_claude_meta(&path).unwrap();
        assert_eq!(meta.id, "sess-1");
        assert_eq!(meta.agent, "claude");
        assert_eq!(meta.project_cwd, "/p/alpha");
        assert_eq!(meta.title, "hello");
        // u1, a1, a2 count; the isMeta line and tool_result-only user line do not.
        assert_eq!(meta.message_count, 3);
        assert_eq!(meta.user_message_count, 1);
        assert_eq!(meta.output_tokens, Some(20));
        assert_eq!(meta.model.as_deref(), Some("claude-sonnet-5"));
        assert!(meta.started_at < meta.ended_at);
        assert!(!meta.activity.is_empty());
    }

    #[test]
    fn transcript_extracts_text_and_tool_entries_in_order() {
        let path = write_fixture("transcript", BASIC);
        let t = parse_claude_transcript(&path);
        let roles: Vec<&str> = t.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, vec!["user", "assistant", "tool", "assistant"]);
        assert_eq!(t[2].tool_name.as_deref(), Some("Bash"));
        assert_eq!(t[3].text, "done");
    }

    // Harness-injected turns are recorded as `type: "user"` but are not the
    // user's own words: teammate messages, system reminders, background task
    // notifications, and slash-command envelopes.
    const INJECTED: &str = concat!(
        r#"{"type":"user","uuid":"u1","parentUuid":null,"sessionId":"s","cwd":"/p","timestamp":"2026-07-06T01:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"real question"}]}}"#, "\n",
        r#"{"type":"assistant","uuid":"a1","parentUuid":"u1","timestamp":"2026-07-06T01:00:05.000Z","message":{"role":"assistant","content":[{"type":"text","text":"answer"}]}}"#, "\n",
        r#"{"type":"user","uuid":"u2","parentUuid":"a1","timestamp":"2026-07-06T01:01:00.000Z","message":{"role":"user","content":[{"type":"text","text":"Another Claude session sent a message:\n<teammate-message teammate_id=\"scan\">## report\n- **finding** one</teammate-message>"}]}}"#, "\n",
        r#"{"type":"assistant","uuid":"a2","parentUuid":"u2","timestamp":"2026-07-06T01:02:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"noted"}]}}"#, "\n",
        r#"{"type":"user","uuid":"u3","parentUuid":"a2","timestamp":"2026-07-06T01:03:00.000Z","message":{"role":"user","content":[{"type":"text","text":"<system-reminder>hooks fired</system-reminder>"}]}}"#, "\n",
        r#"{"type":"user","uuid":"u4","parentUuid":"u3","timestamp":"2026-07-06T01:04:00.000Z","message":{"role":"user","content":[{"type":"text","text":"<task-notification>\n<task-id>x</task-id>\n</task-notification>"}]}}"#, "\n",
    );

    #[test]
    fn injected_turns_render_as_injected_role_with_their_source() {
        let path = write_fixture("injected", INJECTED);
        let t = parse_claude_transcript(&path);
        let roles: Vec<&str> = t.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, vec!["user", "assistant", "injected", "assistant", "injected", "injected"]);
        assert_eq!(t[2].tool_name.as_deref(), Some("teammate"));
        assert_eq!(t[4].tool_name.as_deref(), Some("system-reminder"));
        assert_eq!(t[5].tool_name.as_deref(), Some("task-notification"));
        // The full injected text is preserved for the expanded view.
        assert!(t[2].text.contains("**finding** one"));
    }

    #[test]
    fn injected_turns_do_not_count_as_user_messages() {
        let path = write_fixture("injected-meta", INJECTED);
        let meta = parse_claude_meta(&path).unwrap();
        // u1 is the only real user turn; u2/u3/u4 are injected. All six
        // countable entries still count as messages.
        assert_eq!(meta.user_message_count, 1);
        assert_eq!(meta.message_count, 6);
        // The title never comes from an injected turn.
        assert_eq!(meta.title, "real question");
    }

    // A fork where the first child's branch has only 1 user turn (<= threshold 3):
    // the walk takes the LAST child, so "retry" wins over "abandoned".
    const FORKED: &str = concat!(
        r#"{"type":"user","uuid":"u1","parentUuid":null,"sessionId":"s","timestamp":"2026-07-06T01:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"root"}]}}"#, "\n",
        r#"{"type":"assistant","uuid":"a-abandoned","parentUuid":"u1","timestamp":"2026-07-06T01:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":"first try"}]}}"#, "\n",
        r#"{"type":"assistant","uuid":"a-kept","parentUuid":"u1","timestamp":"2026-07-06T01:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"second try"}]}}"#, "\n",
        r#"{"type":"user","uuid":"u2","parentUuid":"a-kept","timestamp":"2026-07-06T01:00:03.000Z","message":{"role":"user","content":[{"type":"text","text":"go on"}]}}"#, "\n",
    );

    #[test]
    fn fork_follows_the_retry_branch() {
        let path = write_fixture("fork", FORKED);
        let t = parse_claude_transcript(&path);
        let texts: Vec<&str> = t.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["root", "second try", "go on"]);
    }

    // An isMeta user line with real text sitting on a NON-forked (single-child)
    // main-path segment: the skip rule itself must hide it from the transcript,
    // not fork selection (BASIC's isMeta line is only dropped because it loses
    // a fork).
    const META_ON_MAIN_PATH: &str = concat!(
        r#"{"type":"user","uuid":"u1","parentUuid":null,"sessionId":"s","timestamp":"2026-07-06T01:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}"#, "\n",
        r#"{"type":"assistant","uuid":"a1","parentUuid":"u1","timestamp":"2026-07-06T01:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#, "\n",
        r#"{"type":"user","uuid":"m1","parentUuid":"a1","isMeta":true,"timestamp":"2026-07-06T01:00:02.000Z","message":{"role":"user","content":[{"type":"text","text":"meta noise"}]}}"#, "\n",
        r#"{"type":"user","uuid":"u2","parentUuid":"m1","timestamp":"2026-07-06T01:00:03.000Z","message":{"role":"user","content":[{"type":"text","text":"next"}]}}"#, "\n",
    );

    #[test]
    fn transcript_skips_meta_lines_on_the_main_path() {
        let path = write_fixture("meta-main", META_ON_MAIN_PATH);
        let t = parse_claude_transcript(&path);
        let texts: Vec<&str> = t.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["hello", "hi", "next"]);
    }

    // Real transcripts open with house-keeping records (last-prompt, mode,
    // permission-mode...) that carry no uuid at all. They must never be
    // mistaken for the conversation root, or the DAG walk dead-ends at once.
    #[test]
    fn uuid_less_housekeeping_lines_never_claim_the_root() {
        let contents = format!(
            "{}\n{}",
            r#"{"type":"last-prompt","leafUuid":"x","sessionId":"sess-1"}"#,
            BASIC
        );
        let path = write_fixture("housekeeping-root", &contents);
        let meta = parse_claude_meta(&path).unwrap();
        assert_eq!(meta.message_count, 3);
        assert_eq!(meta.user_message_count, 1);
    }

    // A present-but-empty sessionId/cwd on an early line must not shadow a
    // later non-empty value.
    #[test]
    fn later_non_empty_session_id_and_cwd_win_over_empty_ones() {
        let contents = concat!(
            r#"{"type":"user","uuid":"u1","parentUuid":null,"sessionId":"","cwd":"","timestamp":"2026-07-06T01:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}"#, "\n",
            r#"{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"sess-9","cwd":"/p/beta","timestamp":"2026-07-06T01:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#, "\n",
        );
        let path = write_fixture("empty-ids", contents);
        let meta = parse_claude_meta(&path).unwrap();
        assert_eq!(meta.id, "sess-9");
        assert_eq!(meta.project_cwd, "/p/beta");
    }

    // Corrupt DAG data: a mutual parentUuid cycle (a2 <-> a3) and a
    // self-referencing entry alongside a normal rooted chain. Parsing must
    // terminate and keep the rooted chain.
    const CYCLIC: &str = concat!(
        r#"{"type":"user","uuid":"u1","parentUuid":null,"sessionId":"s","timestamp":"2026-07-06T01:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"start"}]}}"#, "\n",
        r#"{"type":"assistant","uuid":"a1","parentUuid":"u1","timestamp":"2026-07-06T01:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":"one"}]}}"#, "\n",
        r#"{"type":"assistant","uuid":"a2","parentUuid":"a3","timestamp":"2026-07-06T01:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"two"}]}}"#, "\n",
        r#"{"type":"assistant","uuid":"a3","parentUuid":"a2","timestamp":"2026-07-06T01:00:03.000Z","message":{"role":"assistant","content":[{"type":"text","text":"three"}]}}"#, "\n",
        r#"{"type":"assistant","uuid":"x","parentUuid":"x","timestamp":"2026-07-06T01:00:04.000Z","message":{"role":"assistant","content":[{"type":"text","text":"selfie"}]}}"#, "\n",
    );

    // A file where EVERY entry sits in a cycle (no root at all): the walk must
    // fall back to linear order instead of returning nothing or hanging.
    const ALL_CYCLIC: &str = concat!(
        r#"{"type":"user","uuid":"a","parentUuid":"b","sessionId":"s","timestamp":"2026-07-06T01:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"ping"}]}}"#, "\n",
        r#"{"type":"assistant","uuid":"b","parentUuid":"a","timestamp":"2026-07-06T01:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":"pong"}]}}"#, "\n",
    );

    #[test]
    fn cyclic_parent_data_terminates_with_sane_output() {
        let path = write_fixture("cycle", CYCLIC);
        let meta = parse_claude_meta(&path).unwrap();
        // The unreachable cycles are dropped; the rooted u1 -> a1 chain remains.
        assert_eq!(meta.message_count, 2);
        assert_eq!(parse_claude_transcript(&path).len(), 2);

        let path = write_fixture("all-cycle", ALL_CYCLIC);
        let meta = parse_claude_meta(&path).unwrap();
        // No root exists, so linear order keeps both countable messages.
        assert_eq!(meta.message_count, 2);
        assert_eq!(meta.user_message_count, 1);
    }

    #[test]
    fn malformed_lines_are_skipped_not_fatal() {
        let contents = format!("not json\n{}", BASIC);
        let path = write_fixture("malformed", &contents);
        assert!(parse_claude_meta(&path).is_some());
    }

    #[test]
    fn empty_or_unreadable_file_yields_none() {
        let path = write_fixture("empty", "");
        assert!(parse_claude_meta(&path).is_none());
    }

    /// Manual sanity check against a real transcript on this machine. Not run
    /// in CI; run with `cargo test sessions_index::claude -- --ignored --nocapture`
    /// and eyeball the printed metadata for plausibility.
    #[test]
    #[ignore]
    fn sanity_check_against_real_transcript() {
        let home = std::env::var("HOME").expect("HOME must be set to locate ~/.claude/projects");
        let projects_dir = std::path::Path::new(&home).join(".claude").join("projects");

        let mut newest: Option<(std::time::SystemTime, std::path::PathBuf)> = None;
        let project_dirs = std::fs::read_dir(&projects_dir).expect("read ~/.claude/projects");
        for project_dir in project_dirs.flatten() {
            let project_path = project_dir.path();
            if !project_path.is_dir() {
                continue;
            }
            let Ok(files) = std::fs::read_dir(&project_path) else { continue };
            for file in files.flatten() {
                let path = file.path();
                if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                    continue;
                }
                if let Ok(modified) = file.metadata().and_then(|m| m.modified()) {
                    if newest.as_ref().map_or(true, |(t, _)| modified > *t) {
                        newest = Some((modified, path));
                    }
                }
            }
        }

        let (_, path) = newest.expect("no real transcript found under ~/.claude/projects");
        println!("sanity-checking real transcript: {}", path.display());
        let meta = parse_claude_meta(&path).expect("expected a parseable session");
        println!("id = {}", meta.id);
        println!("project_cwd = {}", meta.project_cwd);
        println!("title = {}", meta.title);
        println!("started_at = {}  ended_at = {}", meta.started_at, meta.ended_at);
        println!(
            "message_count = {}  user_message_count = {}",
            meta.message_count, meta.user_message_count
        );
        println!("output_tokens = {:?}", meta.output_tokens);
        println!("model = {:?}", meta.model);
        println!("activity buckets = {}", meta.activity.len());
        for bucket in meta.activity.iter().take(5) {
            println!(
                "  {} h{:02}  messages={} user_messages={} output_tokens={}",
                bucket.date, bucket.hour, bucket.messages, bucket.user_messages, bucket.output_tokens
            );
        }

        let transcript = parse_claude_transcript(&path);
        println!("transcript entries = {}", transcript.len());
        for m in transcript.iter().take(3) {
            println!("  [{}] {:.80}", m.role, m.text);
        }
    }
}

#[test]
#[ignore]
fn repro_transcript_json_size() {
    // throwaway: measure the serialized IPC payload size for big transcripts
    for p in [
        "/Users/muki/.claude/projects/-Users-muki-Documents-01-project-tempo-term/885f7e3a-3e3f-4565-911e-23b55cdaea50.jsonl",
        "/Users/muki/.claude/projects/-Users-muki-Documents-01-project-hyday-source/a22e255d-db43-40e3-bb77-ab3be5e82ed5.jsonl",
    ] {
        let t = parse_claude_transcript(std::path::Path::new(p));
        let json = serde_json::to_string(&t).unwrap();
        let max = t.iter().map(|m| m.text.len()).max().unwrap_or(0);
        println!("{}: {} msgs, JSON {} bytes ({:.1} MB), largest text {} bytes", p.rsplit('/').next().unwrap(), t.len(), json.len(), json.len() as f64/1e6, max);
    }
}
