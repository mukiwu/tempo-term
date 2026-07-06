//! Codex rollout JSONL parser. Codex sessions are a flat event log (no
//! uuid/parentUuid DAG like Claude's), so parsing is a single linear pass:
//! `session_meta` gives identity, `event_msg`/`user_message` and
//! `response_item`/`message` (role "assistant") are the conversational
//! turns, `response_item`/`function_call` is a tool call, and
//! `event_msg`/`token_count` carries the running token totals.
//!
//! Grounded against real files on this machine
//! (`~/.codex/sessions/2026/*/*/rollout-*.jsonl`, 2026-07-07): a
//! `token_count` event's actual shape is
//! `payload.info.total_token_usage.{input_tokens,cached_input_tokens,
//! output_tokens,reasoning_output_tokens,total_tokens}` plus a sibling
//! `model_context_window` and a `rate_limits` block — matches the brief's
//! expected `payload.info.total_token_usage.output_tokens` path. Out of
//! 2300 sampled `token_count` events, 15 had `payload.info == null` (no
//! usage yet on that turn), so every access along that path must be a
//! defensive `.get()` chain, never an index/unwrap.

use std::collections::HashMap;
use std::path::Path;

use serde_json::Value;

use super::claude::{epoch_ms, local_bucket};
use super::types::{ActivityBucket, ParsedSession, TranscriptMessage};

/// Tool call argument preview length, matching claude.rs's convention.
const TOOL_INPUT_PREVIEW_CHARS: usize = 400;

/// Title convention shared with claude_progress::MAX_TITLE_CHARS.
const MAX_TITLE_CHARS: usize = 80;

/// Parse every line into a `Value`, silently dropping lines that aren't
/// valid JSON. Blank lines are ignored too. Never panics on malformed input.
fn parse_lines(contents: &str) -> Vec<Value> {
    contents
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            serde_json::from_str(line).ok()
        })
        .collect()
}

/// The joined `.text` fields of a `response_item` message's `content[]`,
/// e.g. `[{"type":"output_text","text":"..."}]`. Items without a string
/// `text` field (images, refusals, ...) are skipped rather than failing the
/// whole message.
fn join_content_text(content: Option<&Value>) -> String {
    let Some(Value::Array(items)) = content else {
        return String::new();
    };
    items
        .iter()
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The local-day/hour activity bucket for a timestamp, created on first use.
fn get_or_create_bucket(buckets: &mut HashMap<(String, u8), ActivityBucket>, ts: i64) -> &mut ActivityBucket {
    let (date, hour) = local_bucket(ts);
    buckets.entry((date.clone(), hour)).or_insert_with(|| ActivityBucket {
        date,
        hour,
        messages: 0,
        user_messages: 0,
        output_tokens: 0,
    })
}

/// Add one message to its local-day/hour activity bucket.
fn bump_message_bucket(buckets: &mut HashMap<(String, u8), ActivityBucket>, ts: i64, is_user: bool) {
    let bucket = get_or_create_bucket(buckets, ts);
    bucket.messages += 1;
    if is_user {
        bucket.user_messages += 1;
    }
}

/// Parse a Codex rollout transcript into index metadata, or `None` when the
/// file is empty, unreadable, or has zero user AND zero assistant messages.
pub fn parse_codex_meta(path: &Path) -> Option<ParsedSession> {
    let contents = std::fs::read_to_string(path).ok()?;
    let lines = parse_lines(&contents);
    if lines.is_empty() {
        return None;
    }

    let mut id: Option<String> = None;
    let mut project_cwd: Option<String> = None;
    let mut title: Option<String> = None;
    let mut message_count: i64 = 0;
    let mut user_message_count: i64 = 0;
    let mut output_tokens: Option<i64> = None;
    let mut model: Option<String> = None;
    let mut started_at = i64::MAX;
    let mut ended_at = i64::MIN;
    let mut buckets: HashMap<(String, u8), ActivityBucket> = HashMap::new();

    for value in &lines {
        let ts = value.get("timestamp").and_then(Value::as_str).and_then(epoch_ms);
        if let Some(ts) = ts {
            started_at = started_at.min(ts);
            ended_at = ended_at.max(ts);
        }

        let type_ = value.get("type").and_then(Value::as_str).unwrap_or("");
        let Some(payload) = value.get("payload") else { continue };

        match type_ {
            "session_meta" => {
                // First non-empty value wins; a later duplicate session_meta
                // (shouldn't happen, but the log is defensive) never
                // overwrites an already-found id/cwd.
                if id.is_none() {
                    if let Some(v) = payload.get("id").and_then(Value::as_str) {
                        if !v.is_empty() {
                            id = Some(v.to_string());
                        }
                    }
                }
                if project_cwd.is_none() {
                    if let Some(v) = payload.get("cwd").and_then(Value::as_str) {
                        if !v.is_empty() {
                            project_cwd = Some(v.to_string());
                        }
                    }
                }
            }
            "turn_context" => {
                // Last turn_context's model wins: later lines simply
                // overwrite earlier ones as the scan proceeds in order.
                if let Some(m) = payload.get("model").and_then(Value::as_str) {
                    model = Some(m.to_string());
                }
            }
            "event_msg" => {
                let etype = payload.get("type").and_then(Value::as_str).unwrap_or("");
                match etype {
                    "user_message" => {
                        let text = payload.get("message").and_then(Value::as_str).map(str::trim).unwrap_or("");
                        if text.is_empty() {
                            continue;
                        }
                        message_count += 1;
                        user_message_count += 1;
                        if title.is_none() {
                            title = Some(text.chars().take(MAX_TITLE_CHARS).collect());
                        }
                        if let Some(ts) = ts {
                            bump_message_bucket(&mut buckets, ts, true);
                        }
                    }
                    "token_count" => {
                        // Cumulative counter: keep the last value seen (not a
                        // running sum), but saturate the bucket delta so a
                        // corrupt/decreasing value can't underflow.
                        if let Some(total) = payload
                            .get("info")
                            .and_then(|i| i.get("total_token_usage"))
                            .and_then(|u| u.get("output_tokens"))
                            .and_then(Value::as_i64)
                        {
                            let delta = total.saturating_sub(output_tokens.unwrap_or(0));
                            output_tokens = Some(total);
                            if delta > 0 {
                                if let Some(ts) = ts {
                                    let bucket = get_or_create_bucket(&mut buckets, ts);
                                    bucket.output_tokens = bucket.output_tokens.saturating_add(delta);
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            "response_item" => {
                let rtype = payload.get("type").and_then(Value::as_str).unwrap_or("");
                if rtype == "message" {
                    // Only the assistant's own turns count. The rollout also
                    // replays the user's turn as a response_item with
                    // role:"user" (already counted via event_msg above), and
                    // carries developer/system instructions — both must be
                    // skipped here or messages get double-counted.
                    let role = payload.get("role").and_then(Value::as_str).unwrap_or("");
                    if role == "assistant" {
                        let text = join_content_text(payload.get("content"));
                        if !text.is_empty() {
                            message_count += 1;
                            if let Some(ts) = ts {
                                bump_message_bucket(&mut buckets, ts, false);
                            }
                        }
                    }
                }
                // function_call/custom_tool_call and their *_output records
                // are tool plumbing, not conversational messages; they don't
                // affect message_count.
            }
            _ => {}
        }
    }

    if message_count == 0 {
        return None;
    }

    if started_at > ended_at {
        started_at = 0;
        ended_at = 0;
    }

    let id = id.unwrap_or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default());
    let project_cwd = project_cwd.unwrap_or_default();
    let title = title.unwrap_or_default();

    let mut activity: Vec<ActivityBucket> = buckets.into_values().collect();
    activity.sort_by(|a, b| (a.date.as_str(), a.hour).cmp(&(b.date.as_str(), b.hour)));

    Some(ParsedSession {
        id,
        agent: "codex",
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

/// Parse a Codex rollout transcript into the viewer's message list,
/// re-derived from the source file on demand. Empty on any read failure.
pub fn parse_codex_transcript(path: &Path) -> Vec<TranscriptMessage> {
    let contents = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let lines = parse_lines(&contents);

    let mut out = Vec::new();
    for value in &lines {
        let ts = value.get("timestamp").and_then(Value::as_str).and_then(epoch_ms);
        let type_ = value.get("type").and_then(Value::as_str).unwrap_or("");
        let Some(payload) = value.get("payload") else { continue };

        match type_ {
            "event_msg" => {
                if payload.get("type").and_then(Value::as_str) == Some("user_message") {
                    let text = payload.get("message").and_then(Value::as_str).map(str::trim).unwrap_or("");
                    if !text.is_empty() {
                        out.push(TranscriptMessage {
                            role: "user".to_string(),
                            text: text.to_string(),
                            timestamp: ts,
                            tool_name: None,
                        });
                    }
                }
            }
            "response_item" => {
                let rtype = payload.get("type").and_then(Value::as_str).unwrap_or("");
                match rtype {
                    "message" => {
                        let role = payload.get("role").and_then(Value::as_str).unwrap_or("");
                        // Same skip rule as parse_codex_meta: developer,
                        // system, and the replayed user role never render.
                        if role == "assistant" {
                            let text = join_content_text(payload.get("content"));
                            if !text.is_empty() {
                                out.push(TranscriptMessage {
                                    role: "assistant".to_string(),
                                    text,
                                    timestamp: ts,
                                    tool_name: None,
                                });
                            }
                        }
                    }
                    // custom_tool_call is the same thing under another name
                    // (real files: apply_patch arrives this way, with the
                    // payload in `input` instead of `arguments`) — same as
                    // codexNormalize.ts, which treats the two as equivalent.
                    "function_call" | "custom_tool_call" => {
                        let name = payload.get("name").and_then(Value::as_str).unwrap_or("tool").to_string();
                        let text: String = payload
                            .get("arguments")
                            .or_else(|| payload.get("input"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .chars()
                            .take(TOOL_INPUT_PREVIEW_CHARS)
                            .collect();
                        out.push(TranscriptMessage {
                            role: "tool".to_string(),
                            text,
                            timestamp: ts,
                            tool_name: Some(name),
                        });
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROLLOUT: &str = concat!(
        r#"{"timestamp":"2026-07-06T02:00:00.000Z","type":"session_meta","payload":{"id":"codex-1","cwd":"/p/beta"}}"#, "\n",
        r#"{"timestamp":"2026-07-06T02:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"fix the bug"}}"#, "\n",
        r#"{"timestamp":"2026-07-06T02:00:02.000Z","type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"instructions"}]}}"#, "\n",
        r#"{"timestamp":"2026-07-06T02:00:03.000Z","type":"turn_context","payload":{"model":"gpt-5.2-codex"}}"#, "\n",
        r#"{"timestamp":"2026-07-06T02:00:04.000Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{}"}}"#, "\n",
        r#"{"timestamp":"2026-07-06T02:00:05.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"fixed"}]}}"#, "\n",
        r#"{"timestamp":"2026-07-06T02:00:06.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":42}}}}"#, "\n",
    );

    fn write_fixture(tag: &str, contents: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tt-codex-parse-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rollout-x.jsonl");
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn meta_from_rollout_events() {
        let meta = parse_codex_meta(&write_fixture("meta", ROLLOUT)).unwrap();
        assert_eq!(meta.id, "codex-1");
        assert_eq!(meta.agent, "codex");
        assert_eq!(meta.project_cwd, "/p/beta");
        assert_eq!(meta.title, "fix the bug");
        assert_eq!(meta.user_message_count, 1);
        assert_eq!(meta.message_count, 2); // user + assistant; developer/tool excluded
        assert_eq!(meta.output_tokens, Some(42));
        assert_eq!(meta.model.as_deref(), Some("gpt-5.2-codex"));
    }

    #[test]
    fn transcript_orders_user_tool_assistant() {
        let t = parse_codex_transcript(&write_fixture("transcript", ROLLOUT));
        let roles: Vec<&str> = t.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, vec!["user", "tool", "assistant"]);
        assert_eq!(t[1].tool_name.as_deref(), Some("shell"));
    }

    #[test]
    fn missing_session_meta_falls_back_to_file_stem_and_survives() {
        let contents = concat!(
            r#"{"timestamp":"2026-07-06T02:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"hi"}}"#, "\n",
        );
        let path = write_fixture("nometa", contents);
        let meta = parse_codex_meta(&path).unwrap();
        assert_eq!(meta.id, "rollout-x");
        assert_eq!(meta.project_cwd, "");
    }

    #[test]
    fn garbage_lines_are_skipped() {
        let contents = format!("garbage\n{}", ROLLOUT);
        assert!(parse_codex_meta(&write_fixture("garbage", &contents)).is_some());
    }

    // Real rollouts carry apply_patch (and other custom tools) as
    // `custom_tool_call` with the payload in `input` rather than
    // `arguments`; it must render as a tool row exactly like function_call
    // (consistent with codexNormalize.ts, which treats them as equivalent).
    #[test]
    fn custom_tool_call_renders_as_tool_row() {
        let contents = concat!(
            r#"{"timestamp":"2026-07-06T02:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"patch it"}}"#, "\n",
            r#"{"timestamp":"2026-07-06T02:00:02.000Z","type":"response_item","payload":{"type":"custom_tool_call","status":"completed","call_id":"call_1","name":"apply_patch","input":"*** Begin Patch"}}"#, "\n",
            r#"{"timestamp":"2026-07-06T02:00:03.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}}"#, "\n",
        );
        let path = write_fixture("customtool", contents);

        let t = parse_codex_transcript(&path);
        let roles: Vec<&str> = t.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, vec!["user", "tool", "assistant"]);
        assert_eq!(t[1].tool_name.as_deref(), Some("apply_patch"));
        assert_eq!(t[1].text, "*** Begin Patch");

        // Tool plumbing still never counts as a conversational message.
        let meta = parse_codex_meta(&path).unwrap();
        assert_eq!(meta.message_count, 2);
    }
}
