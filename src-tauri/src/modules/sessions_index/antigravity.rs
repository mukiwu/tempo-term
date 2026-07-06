//! Parser for Antigravity CLI session trajectories.
//!
//! Antigravity CLI stores each session as a SQLite "trajectory" DB under
//! `~/.gemini/antigravity-cli/conversations/<uuid>.db`. Unlike Claude's
//! JSONL uuid/parentUuid DAG or Codex's flat event log, conversational turns
//! live in a `steps` table (`step_type` 14 = user, 15 = assistant), with the
//! message text and timestamp packed into a `step_payload` protobuf blob.
//! The schema exposes no project cwd anywhere, so `project_cwd` is always
//! empty for this agent — the sidebar shows the agent badge instead of a
//! project.
//!
//! Grounded against real DBs on this machine
//! (`~/.gemini/antigravity-cli/conversations/*.db`, 2026-07-07): confirmed
//! `steps(idx, step_type, status, ..., step_payload BLOB, step_format)` and
//! `gen_metadata(idx, data BLOB, size)` match the brief exactly.
//!
//! ## Correction: `step_payload`'s text/timestamp fields
//!
//! The brief (based on an earlier check) expected a flat shape: field 17 =
//! text, field 5 = the `Timestamp` message directly. Decoding ~1,000 real
//! steps across 100 real DBs on this machine found **zero** occurrences of a
//! top-level field 17, in any step, ever. The real shape is one level
//! deeper, and role-specific:
//!
//!   - Text: a user step's (`step_type` 14) payload wraps its content in
//!     field 19, whose sub-field 2 is the plain-text prompt. An assistant
//!     step's (`step_type` 15) payload wraps its content in field 20, whose
//!     sub-field 3 is the visible text — present only on turns that produce
//!     visible content; tool-call-only turns (~57% of assistant steps
//!     sampled) omit it entirely and are legitimately skipped, per the
//!     brief's "skip steps whose payload lacks text" rule.
//!   - Timestamp: field 5 is itself a step-metadata wrapper (also carrying a
//!     status code, step/trajectory uuids, ...), not the `Timestamp`
//!     message itself. The real `Timestamp` (seconds field 1, nanos field
//!     2) sits at field 5's own sub-field 1.
//!
//! `extract_text` and `extract_timestamp_ms` below try this real shape
//! first, then fall back to the brief's original flat shape (field 17 /
//! field 5-is-`Timestamp`) — both so a future/alternate encoding degrades
//! gracefully instead of going silently blank, and because the brief's
//! mandated fixture tests (`meta_from_trajectory_db`,
//! `transcript_maps_step_types_to_roles`) encode exactly that flat shape.
//!
//! Verified end-to-end against real conversations, via `parse_antigravity_meta`
//! and `parse_antigravity_transcript` themselves rather than raw field dumps:
//! titles, message counts, timestamps, and the resolved model all come out
//! plausible, e.g. a one-line greeting session titled "你好，只回我一句問候"
//! (message_count 1) and a 7-message reflection-assistant trajectory with
//! alternating user/assistant text. A handful of real DBs transiently
//! yielded `None` on the first attempt because Antigravity CLI itself had
//! them open (`SQLITE_CANTOPEN` on a live WAL/shm pair) — re-running moments
//! later parsed them fine, confirming this is the documented "locked DB ⇒
//! None, sync retries next round" case, not a parsing defect.
//!
//! ## Spike findings (model/token fields, see `dump_real_gen_metadata`)
//!
//! Each `gen_metadata` row's `data` blob is itself a small protobuf message
//! whose field 1 is one large nested "generation metadata" submessage (deep
//! internal bookkeeping: cache keys, region/latency stats, tool-schema
//! blobs). Inside that submessage, sampled across ~10 real DBs:
//!
//!   - field 19 (bytes/UTF-8): a short internal generation-config name, e.g.
//!     `"gemini-3-flash-a"` or `"gemini-default"` — varies per row/DB, reads
//!     like an internal slug rather than a stable display name.
//!   - field 21 (bytes/UTF-8): a human-readable model display string, e.g.
//!     `"Gemini 3.5 Flash (Medium)"` — present on every sampled row across
//!     every sampled DB, so this is what `model` is extracted from below
//!     (last `gen_metadata` row wins, mirroring Codex's "last
//!     `turn_context`'s model wins" convention, in case a session switches
//!     models mid-way).
//!   - No field anywhere in the sampled blobs carries a labelled
//!     input/output token count: the numeric fields near the model info are
//!     unlabelled varints (byte offsets, hashes, latency numbers) with no
//!     way to confidently tell "output tokens" apart from other counters.
//!     Per the brief's documented-degradation rule, `output_tokens` ships as
//!     `None` for this agent.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{Connection, OpenFlags};

use super::claude::local_bucket;
use super::proto::{first_bytes, first_varint, parse_fields, timestamp_ms, ProtoValue};
use super::types::{ActivityBucket, ParsedSession, TranscriptMessage};

const STEP_TYPE_USER: i64 = 14;
const STEP_TYPE_ASSISTANT: i64 = 15;
const PAYLOAD_FIELD_TIMESTAMP: u32 = 5;

/// Legacy/fixture text shape: a flat top-level field holding the text
/// directly (see the module doc's "Correction" section).
const PAYLOAD_FIELD_TEXT_LEGACY: u32 = 17;
/// Real shape: role-specific wrapper field, and the text sub-field inside it.
const PAYLOAD_FIELD_USER_WRAPPER: u32 = 19;
const PAYLOAD_FIELD_USER_TEXT: u32 = 2;
const PAYLOAD_FIELD_ASSISTANT_WRAPPER: u32 = 20;
const PAYLOAD_FIELD_ASSISTANT_TEXT: u32 = 3;
/// Real shape: field 5 is a step-metadata wrapper; the actual `Timestamp`
/// submessage is one level deeper, at this sub-field.
const TIMESTAMP_WRAPPER_INNER_FIELD: u32 = 1;

const MAX_TITLE_CHARS: usize = 80;

/// Field numbers inside a `gen_metadata` row's nested generation-metadata
/// submessage (see the module doc for how these were identified).
const GEN_METADATA_INNER_FIELD: u32 = 1;
const GEN_METADATA_MODEL_NAME_FIELD: u32 = 21;

/// Opens a trajectory DB read-only. Any failure (missing file, locked by the
/// Antigravity CLI process, corrupt SQLite header, ...) yields `None` rather
/// than an error — the sync loop just retries next round.
fn open_read_only(path: &Path) -> Option<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
}

/// One decoded conversational step: role + text + (best-effort) timestamp.
struct Step {
    is_user: bool,
    text: String,
    timestamp_ms: Option<i64>,
}

/// Extracts a step's message text: the real role-specific wrapper shape
/// first, falling back to the flat legacy/fixture shape (field 17) — see
/// the module doc's "Correction" section. `None` when neither shape yields
/// non-blank text (e.g. a tool-call-only assistant turn).
fn extract_text(fields: &[(u32, ProtoValue)], is_user: bool) -> Option<String> {
    let (wrapper_field, text_subfield) = if is_user {
        (PAYLOAD_FIELD_USER_WRAPPER, PAYLOAD_FIELD_USER_TEXT)
    } else {
        (PAYLOAD_FIELD_ASSISTANT_WRAPPER, PAYLOAD_FIELD_ASSISTANT_TEXT)
    };
    let real_shape = first_bytes(fields, wrapper_field)
        .map(parse_fields)
        .and_then(|inner| first_bytes(&inner, text_subfield).map(<[u8]>::to_vec));
    let text_bytes = real_shape.or_else(|| first_bytes(fields, PAYLOAD_FIELD_TEXT_LEGACY).map(<[u8]>::to_vec))?;
    let text = std::str::from_utf8(&text_bytes).ok()?.to_string();
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Extracts a step's timestamp: the real nested-wrapper shape first,
/// falling back to treating field 5 as the `Timestamp` message directly
/// (the legacy/fixture shape) — see the module doc's "Correction" section.
fn extract_timestamp_ms(fields: &[(u32, ProtoValue)]) -> Option<i64> {
    let wrapper_bytes = first_bytes(fields, PAYLOAD_FIELD_TIMESTAMP);
    let real_shape = wrapper_bytes.and_then(|wrapper_bytes| {
        let wrapper = parse_fields(wrapper_bytes);
        let ts_bytes = first_bytes(&wrapper, TIMESTAMP_WRAPPER_INNER_FIELD)?;
        let ts_fields = parse_fields(ts_bytes);
        let seconds = first_varint(&ts_fields, 1)? as i64;
        let nanos = first_varint(&ts_fields, 2).unwrap_or(0) as i64;
        seconds.checked_mul(1000)?.checked_add(nanos / 1_000_000)
    });
    real_shape.or_else(|| timestamp_ms(fields, PAYLOAD_FIELD_TIMESTAMP))
}

/// Reads every user/assistant step in `idx` order, decoding each payload's
/// text and timestamp (see `extract_text`/`extract_timestamp_ms`). Steps of
/// any other `step_type`, and steps whose payload can't be decoded or
/// carries no (non-blank) text, are skipped entirely — they never count
/// toward message totals or appear in the transcript.
fn read_steps(conn: &Connection) -> Vec<Step> {
    let mut stmt = match conn.prepare("SELECT step_type, step_payload FROM steps ORDER BY idx") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map([], |row| {
        let step_type: i64 = row.get(0)?;
        let payload: Option<Vec<u8>> = row.get(1)?;
        Ok((step_type, payload))
    });
    let Ok(rows) = rows else { return Vec::new() };

    let mut steps = Vec::new();
    for (step_type, payload) in rows.flatten() {
        let is_user = match step_type {
            STEP_TYPE_USER => true,
            STEP_TYPE_ASSISTANT => false,
            _ => continue,
        };
        let Some(payload) = payload else { continue };
        let fields = parse_fields(&payload);
        let Some(text) = extract_text(&fields, is_user) else { continue };
        let ts = extract_timestamp_ms(&fields);
        steps.push(Step { is_user, text, timestamp_ms: ts });
    }
    steps
}

/// The DB file's mtime in epoch milliseconds, used as a step's timestamp
/// when its payload lacks field 5. `None` if the file's metadata can't be
/// read (e.g. it vanished under us) — the step then simply has no timestamp.
fn file_mtime_ms(path: &Path) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let since_epoch = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(since_epoch.as_millis()).ok()
}

/// Extracts the model display name from the most recent `gen_metadata` row
/// (last row wins, mirroring Codex's "last `turn_context`'s model wins", in
/// case a session switches models mid-way). See the module doc for how
/// field 21 was identified. `None` when there are no `gen_metadata` rows,
/// the blob can't be decoded, or the field is missing/blank.
fn extract_model(conn: &Connection) -> Option<String> {
    let data: Vec<u8> = conn
        .query_row("SELECT data FROM gen_metadata ORDER BY idx DESC LIMIT 1", [], |row| row.get(0))
        .ok()?;
    let top = parse_fields(&data);
    let inner_bytes = first_bytes(&top, GEN_METADATA_INNER_FIELD)?;
    let inner = parse_fields(inner_bytes);
    let model_bytes = first_bytes(&inner, GEN_METADATA_MODEL_NAME_FIELD)?;
    let model = std::str::from_utf8(model_bytes).ok()?.trim();
    if model.is_empty() {
        None
    } else {
        Some(model.to_string())
    }
}

/// Parse an Antigravity CLI trajectory DB into index metadata, or `None`
/// when the DB can't be opened (missing/locked/corrupt) or has zero
/// user/assistant steps carrying text.
pub fn parse_antigravity_meta(path: &Path) -> Option<ParsedSession> {
    let conn = open_read_only(path)?;
    let steps = read_steps(&conn);
    if steps.is_empty() {
        return None;
    }

    let fallback_ts = file_mtime_ms(path);
    let mut message_count: i64 = 0;
    let mut user_message_count: i64 = 0;
    let mut title: Option<String> = None;
    let mut started_at = i64::MAX;
    let mut ended_at = i64::MIN;
    let mut buckets: HashMap<(String, u8), ActivityBucket> = HashMap::new();

    for step in &steps {
        message_count += 1;
        if step.is_user {
            user_message_count += 1;
            if title.is_none() {
                title = Some(step.text.trim().chars().take(MAX_TITLE_CHARS).collect());
            }
        }

        let Some(ts) = step.timestamp_ms.or(fallback_ts) else { continue };
        started_at = started_at.min(ts);
        ended_at = ended_at.max(ts);
        let (date, hour) = local_bucket(ts);
        let bucket = buckets.entry((date.clone(), hour)).or_insert_with(|| ActivityBucket {
            date,
            hour,
            messages: 0,
            user_messages: 0,
            output_tokens: 0,
        });
        bucket.messages += 1;
        if step.is_user {
            bucket.user_messages += 1;
        }
    }

    if started_at > ended_at {
        started_at = 0;
        ended_at = 0;
    }

    let id = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut activity: Vec<ActivityBucket> = buckets.into_values().collect();
    activity.sort_by(|a, b| (a.date.as_str(), a.hour).cmp(&(b.date.as_str(), b.hour)));

    Some(ParsedSession {
        id,
        agent: "antigravity",
        project_cwd: String::new(),
        title: title.unwrap_or_default(),
        started_at,
        ended_at,
        message_count,
        user_message_count,
        output_tokens: None, // see module doc: no confidently identifiable field
        model: extract_model(&conn),
        activity,
    })
}

/// Parse an Antigravity CLI trajectory DB into the viewer's message list,
/// re-derived from the source file on demand. Empty on any open/read
/// failure — the viewer just shows nothing rather than panicking.
pub fn parse_antigravity_transcript(path: &Path) -> Vec<TranscriptMessage> {
    let Some(conn) = open_read_only(path) else { return Vec::new() };
    let steps = read_steps(&conn);
    let fallback_ts = file_mtime_ms(path);

    steps
        .into_iter()
        .map(|step| TranscriptMessage {
            role: if step.is_user { "user".to_string() } else { "assistant".to_string() },
            text: step.text,
            timestamp: step.timestamp_ms.or(fallback_ts),
            tool_name: None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};

    // Test-only encoder helpers (wire format: tag = field_no << 3 | wire_type),
    // copied verbatim from proto.rs's test module.
    fn varint(mut v: u64, out: &mut Vec<u8>) {
        loop {
            let byte = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                out.push(byte);
                break;
            }
            out.push(byte | 0x80);
        }
    }
    fn field_varint(no: u32, v: u64, out: &mut Vec<u8>) {
        varint(((no as u64) << 3) | 0, out);
        varint(v, out);
    }
    fn field_bytes(no: u32, data: &[u8], out: &mut Vec<u8>) {
        varint(((no as u64) << 3) | 2, out);
        varint(data.len() as u64, out);
        out.extend_from_slice(data);
    }

    fn step_payload(ts_seconds: u64, text: &str) -> Vec<u8> {
        let mut ts = Vec::new();
        field_varint(1, ts_seconds, &mut ts);
        let mut buf = Vec::new();
        field_bytes(5, &ts, &mut buf);
        field_bytes(17, text.as_bytes(), &mut buf);
        buf
    }

    fn fixture_db(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tt-ag-parse-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("11111111-2222-3333-4444-555555555555.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE steps(idx INTEGER PRIMARY KEY, step_type INTEGER NOT NULL DEFAULT 0,
               status INTEGER NOT NULL DEFAULT 0, step_payload BLOB, step_format INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY, data BLOB, size INTEGER NOT NULL DEFAULT 0);",
        ).unwrap();
        conn.execute("INSERT INTO steps(idx, step_type, step_payload) VALUES(0, 14, ?1)",
            params![step_payload(1_751_760_000, "build me a thing")]).unwrap();
        conn.execute("INSERT INTO steps(idx, step_type, step_payload) VALUES(1, 15, ?1)",
            params![step_payload(1_751_760_060, "here is the thing")]).unwrap();
        conn.execute("INSERT INTO steps(idx, step_type, step_payload) VALUES(2, 7, ?1)",
            params![step_payload(1_751_760_070, "ignored step type")]).unwrap();
        path
    }

    #[test]
    fn meta_from_trajectory_db() {
        let meta = parse_antigravity_meta(&fixture_db("meta")).unwrap();
        assert_eq!(meta.id, "11111111-2222-3333-4444-555555555555");
        assert_eq!(meta.agent, "antigravity");
        assert_eq!(meta.title, "build me a thing");
        assert_eq!(meta.message_count, 2);
        assert_eq!(meta.user_message_count, 1);
        assert_eq!(meta.started_at, 1_751_760_000_000);
        assert_eq!(meta.ended_at, 1_751_760_060_000);
    }

    #[test]
    fn transcript_maps_step_types_to_roles() {
        let t = parse_antigravity_transcript(&fixture_db("transcript"));
        assert_eq!(t.len(), 2);
        assert_eq!(t[0].role, "user");
        assert_eq!(t[1].role, "assistant");
        assert_eq!(t[1].text, "here is the thing");
    }

    #[test]
    fn missing_or_invalid_db_yields_none() {
        assert!(parse_antigravity_meta(std::path::Path::new("/nope/x.db")).is_none());
    }

    /// Encodes a `step_payload` using the REAL nested shape observed in
    /// production DBs (see the module doc's "Correction" section):
    ///
    ///   - field 5 = step-metadata wrapper whose sub-field 1 is the
    ///     `Timestamp` message (seconds field 1, nanos field 2), alongside
    ///     sibling bookkeeping fields the parser must ignore;
    ///   - text inside a role-specific wrapper: field 19 sub-field 2 for
    ///     user steps, field 20 sub-field 3 for assistant steps, again with
    ///     sibling fields present.
    ///
    /// `text: None` builds a tool-call-only turn: the role wrapper exists
    /// but carries no text sub-field, which the parser must skip.
    fn real_step_payload(is_user: bool, ts_seconds: u64, ts_nanos: u64, text: Option<&str>) -> Vec<u8> {
        let mut ts = Vec::new();
        field_varint(1, ts_seconds, &mut ts);
        field_varint(2, ts_nanos, &mut ts);
        let mut ts_wrapper = Vec::new();
        field_bytes(1, &ts, &mut ts_wrapper);
        field_varint(3, 4, &mut ts_wrapper); // sibling status code, as in real data

        let (wrapper_no, text_no) = if is_user { (19u32, 2u32) } else { (20u32, 3u32) };
        let mut content = Vec::new();
        field_bytes(6, b"bot-uuid-noise", &mut content); // sibling field, as in real data
        if let Some(text) = text {
            field_bytes(text_no, text.as_bytes(), &mut content);
        }

        let mut buf = Vec::new();
        field_varint(1, if is_user { 14 } else { 15 }, &mut buf); // step type echo, as in real data
        field_bytes(5, &ts_wrapper, &mut buf);
        field_bytes(wrapper_no, &content, &mut buf);
        buf
    }

    /// A fixture DB whose payloads use the real nested encoding, plus one
    /// `gen_metadata` row shaped like production (field 1 submessage with
    /// the model display name at sub-field 21).
    fn real_shape_fixture_db(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tt-ag-real-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE steps(idx INTEGER PRIMARY KEY, step_type INTEGER NOT NULL DEFAULT 0,
               status INTEGER NOT NULL DEFAULT 0, step_payload BLOB, step_format INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY, data BLOB, size INTEGER NOT NULL DEFAULT 0);",
        ).unwrap();
        conn.execute("INSERT INTO steps(idx, step_type, step_payload) VALUES(0, 14, ?1)",
            params![real_step_payload(true, 1_751_760_000, 500_000_000, Some("real user prompt"))]).unwrap();
        conn.execute("INSERT INTO steps(idx, step_type, step_payload) VALUES(1, 15, ?1)",
            params![real_step_payload(false, 1_751_760_060, 0, Some("real assistant reply"))]).unwrap();
        // Tool-call-only assistant turn: wrapper present, no text sub-field.
        conn.execute("INSERT INTO steps(idx, step_type, step_payload) VALUES(2, 15, ?1)",
            params![real_step_payload(false, 1_751_760_070, 0, None)]).unwrap();
        // Non-conversational step type, ignored outright.
        conn.execute("INSERT INTO steps(idx, step_type, step_payload) VALUES(3, 7, ?1)",
            params![real_step_payload(true, 1_751_760_080, 0, Some("ignored step type"))]).unwrap();

        let mut inner = Vec::new();
        field_bytes(19, b"gemini-slug-noise", &mut inner);
        field_bytes(21, b"Gemini Test Model", &mut inner);
        let mut gm = Vec::new();
        field_bytes(1, &inner, &mut gm);
        conn.execute("INSERT INTO gen_metadata(idx, data, size) VALUES(0, ?1, ?2)",
            params![gm.clone(), gm.len() as i64]).unwrap();
        path
    }

    #[test]
    fn meta_from_real_shape_trajectory_db() {
        let meta = parse_antigravity_meta(&real_shape_fixture_db("meta")).unwrap();
        assert_eq!(meta.id, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        assert_eq!(meta.agent, "antigravity");
        assert_eq!(meta.title, "real user prompt");
        // The text-less tool-call-only turn and the type-7 step don't count.
        assert_eq!(meta.message_count, 2);
        assert_eq!(meta.user_message_count, 1);
        // Exact values prove the nested Timestamp (incl. nanos -> ms) was
        // decoded, not the file-mtime fallback.
        assert_eq!(meta.started_at, 1_751_760_000_500);
        assert_eq!(meta.ended_at, 1_751_760_060_000);
        assert_eq!(meta.model.as_deref(), Some("Gemini Test Model"));
        assert_eq!(meta.output_tokens, None);
    }

    #[test]
    fn transcript_from_real_shape_maps_roles_and_text() {
        let t = parse_antigravity_transcript(&real_shape_fixture_db("transcript"));
        assert_eq!(t.len(), 2);
        assert_eq!(t[0].role, "user");
        assert_eq!(t[0].text, "real user prompt");
        assert_eq!(t[0].timestamp, Some(1_751_760_000_500));
        assert_eq!(t[1].role, "assistant");
        assert_eq!(t[1].text, "real assistant reply");
        assert_eq!(t[1].timestamp, Some(1_751_760_060_000));
    }

    /// Prints one decoded protobuf field for the spike/sanity dumps: field
    /// number, wire type, and either the varint value or a UTF-8/hex preview
    /// of bytes. Recurses (bounded by `depth`) into `Bytes` fields since the
    /// interesting model data in `gen_metadata` sits inside a nested
    /// submessage (field 1) — see the module doc.
    fn print_field(no: u32, value: &super::super::proto::ProtoValue, indent: &str, depth: u32) {
        use super::super::proto::ProtoValue;
        match value {
            ProtoValue::Varint(v) => println!("{indent}field {no} (varint): {v}"),
            ProtoValue::Fixed64(v) => println!("{indent}field {no} (fixed64): {v}"),
            ProtoValue::Fixed32(v) => println!("{indent}field {no} (fixed32): {v}"),
            ProtoValue::Bytes(data) => {
                let preview = match std::str::from_utf8(data) {
                    Ok(s) if !s.chars().any(|c| c.is_control() && c != '\n' && c != '\t') => {
                        // chars(), not a byte slice: slicing at byte 120 can
                        // panic on a multibyte (e.g. CJK) char boundary.
                        format!("UTF8 {:?}", s.chars().take(120).collect::<String>())
                    }
                    _ => format!("hex {}", data.iter().take(24).map(|b| format!("{b:02x}")).collect::<String>()),
                };
                println!("{indent}field {no} (bytes, len={}): {preview}", data.len());
                if depth > 0 && !data.is_empty() {
                    let nested = parse_fields(data);
                    let deeper = format!("{indent}  ");
                    for (nno, nvalue) in &nested {
                        print_field(*nno, nvalue, &deeper, depth - 1);
                    }
                }
            }
        }
    }

    /// Real DBs on this machine, newest first, for the spike/sanity checks.
    fn real_conversation_dbs(limit: usize) -> Vec<std::path::PathBuf> {
        let home = std::env::var("HOME").expect("HOME must be set to locate ~/.gemini/antigravity-cli");
        let dir = std::path::Path::new(&home).join(".gemini").join("antigravity-cli").join("conversations");
        let entries = std::fs::read_dir(&dir).expect("read ~/.gemini/antigravity-cli/conversations");

        let mut dbs: Vec<(std::time::SystemTime, std::path::PathBuf)> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("db"))
            .filter_map(|p| std::fs::metadata(&p).and_then(|m| m.modified()).ok().map(|t| (t, p)))
            .collect();
        dbs.sort_by(|a, b| b.0.cmp(&a.0));
        dbs.truncate(limit);
        dbs.into_iter().map(|(_, p)| p).collect()
    }

    /// Spike (Step 1): dumps decoded `gen_metadata` fields from 2-3 real DBs
    /// so the model/token fields can be identified by eye. Not run in CI;
    /// run with `cargo test sessions_index::antigravity -- --ignored
    /// --nocapture`.
    ///
    /// Findings are recorded in the module doc comment and baked into
    /// `extract_model`; this test is kept so the spike can be re-run if
    /// Antigravity CLI's schema ever changes.
    #[test]
    #[ignore]
    fn dump_real_gen_metadata() {
        let dbs = real_conversation_dbs(3);
        assert!(!dbs.is_empty(), "no real Antigravity CLI DBs found for the spike");

        for path in &dbs {
            println!("=== {} ===", path.display());
            let Some(conn) = open_read_only(path) else {
                println!("  (could not open: locked/corrupt)");
                continue;
            };
            let mut stmt = match conn.prepare("SELECT idx, data FROM gen_metadata ORDER BY idx DESC") {
                Ok(s) => s,
                Err(e) => {
                    println!("  (no gen_metadata table: {e})");
                    continue;
                }
            };
            let rows = stmt.query_map([], |row| {
                let idx: i64 = row.get(0)?;
                let data: Vec<u8> = row.get(1)?;
                Ok((idx, data))
            });
            let Ok(rows) = rows else { continue };
            for (idx, data) in rows.flatten().take(2) {
                println!("  gen_metadata idx={idx} len={}", data.len());
                let top = parse_fields(&data);
                for (no, value) in &top {
                    print_field(*no, value, "    ", 1);
                }
            }
        }
    }

    /// Sanity check (Step 5) against real conversation DBs on this machine.
    /// Not run in CI; run with `cargo test sessions_index::antigravity --
    /// --ignored --nocapture` and eyeball the printed metadata/transcript
    /// for plausibility (title reads like a real request, roles alternate
    /// sensibly, model looks like a real Gemini model name).
    #[test]
    #[ignore]
    fn sanity_check_against_real_conversations() {
        let dbs = real_conversation_dbs(3);
        assert!(!dbs.is_empty(), "no real Antigravity CLI DBs found for the sanity check");

        for path in &dbs {
            println!("sanity-checking real conversation: {}", path.display());
            let Some(meta) = parse_antigravity_meta(path) else {
                println!("  -> None (no user/assistant steps, or DB locked/corrupt)");
                continue;
            };
            println!("  id = {}", meta.id);
            println!("  title = {:?}", meta.title);
            println!("  message_count = {}  user_message_count = {}", meta.message_count, meta.user_message_count);
            println!("  started_at = {}  ended_at = {}", meta.started_at, meta.ended_at);
            println!("  model = {:?}", meta.model);
            println!("  output_tokens = {:?}", meta.output_tokens);

            let transcript = parse_antigravity_transcript(path);
            println!("  transcript entries = {}", transcript.len());
            for m in transcript.iter().take(3) {
                println!("    [{}] {:.80}", m.role, m.text);
            }
        }
    }
}
