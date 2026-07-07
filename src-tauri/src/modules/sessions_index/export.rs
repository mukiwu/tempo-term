//! Renders a re-parsed transcript as a standalone Markdown file for the
//! export button: a header with the session's metadata, then one section
//! per message. Pure string formatting — no I/O — so it stays cheap to test
//! against every `TranscriptMessage` role without touching a real session
//! file.

use chrono::{DateTime, Local};

use super::types::{SessionSummary, TranscriptMessage};

/// Capitalizes an agent id ("claude" -> "Claude") for the header line. Rust
/// has no access to the frontend's i18n labels, but every agent id is
/// already its lowercase English name, so this is a faithful enough label
/// without threading a translation table through the backend.
fn agent_label(agent: &str) -> String {
    let mut chars = agent.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Epoch-ms timestamp as a local "YYYY-MM-DD" date, for the header's date
/// range — mirrors `claude::local_bucket`'s conversion.
fn local_date(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms)
        .map(|utc| utc.with_timezone(&Local))
        .unwrap_or_else(Local::now)
        .format("%Y-%m-%d")
        .to_string()
}

/// Sanitizes a value that gets interpolated into a markdown-structural
/// label line (`**Tool call: {name}**`, `> **{source}**`): backticks become
/// apostrophes and all whitespace runs (including newlines) collapse to a
/// single space, so a corrupted transcript's tool_name can never break out
/// of its label — e.g. open a rogue fence above the real fenced body.
fn sanitize_label(s: &str) -> String {
    s.replace('`', "'").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `sanitize_label` over an optional raw value, falling back to `fallback`
/// both when the value is absent and when nothing survives sanitizing
/// (a whitespace-only name would otherwise leave an empty label).
fn label_or(raw: Option<&str>, fallback: &str) -> String {
    let label = sanitize_label(raw.unwrap_or(fallback));
    if label.is_empty() {
        fallback.to_string()
    } else {
        label
    }
}

/// Longest run of consecutive backticks anywhere in `text`. The fence that
/// wraps `text` in a code block must be longer than this, or a tool call
/// that itself echoes a fenced block (e.g. a `write_file` call whose input
/// contains ` ``` `) would prematurely close the wrapper at the first
/// matching run instead of at the intended end.
fn longest_backtick_run(text: &str) -> usize {
    let mut longest = 0usize;
    let mut run = 0usize;
    for ch in text.chars() {
        if ch == '`' {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 0;
        }
    }
    longest
}

/// Wraps `text` in a fence long enough to never collide with a backtick run
/// already inside it, minimum three backticks (the shortest valid fence).
fn fenced_block(text: &str) -> String {
    let fence = "`".repeat((longest_backtick_run(text) + 1).max(3));
    format!("{fence}\n{text}\n{fence}\n")
}

/// Prefixes every line of `text` with a blockquote marker. Empty lines get a
/// bare `>` (no trailing space) rather than `> ` so the rendered file has no
/// trailing whitespace on blank quoted lines.
fn blockquote(text: &str) -> String {
    text.lines()
        .map(|line| if line.is_empty() { ">".to_string() } else { format!("> {line}") })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Renders a session transcript as Markdown: an H1 title, a metadata line
/// (agent, project, local date range), then one section per message — "##
/// You" / "## Assistant" with the verbatim text, tool calls as a fenced
/// code block labelled with the tool name, harness-injected turns as a
/// blockquote labelled with their source tag, and system notices as an
/// italic line. An empty transcript renders just the header: still a valid,
/// readable file rather than an error.
pub fn transcript_to_markdown(summary: &SessionSummary, messages: &[TranscriptMessage]) -> String {
    let start = local_date(summary.started_at);
    let end = local_date(summary.ended_at);
    // A session that starts and ends on the same local day reads better as
    // a single date than as "X – X".
    let dates = if start == end { start } else { format!("{start} – {end}") };
    // The project path goes in an inline code span so its `_`/`*`/etc. render
    // literally instead of as markdown emphasis. Paths never contain backticks,
    // so the span can't be broken from the inside.
    let mut out = format!(
        "# {title}\n\n{agent} · `{project}` · {dates}\n",
        title = summary.title,
        agent = agent_label(&summary.agent),
        project = summary.project_cwd,
    );

    for message in messages {
        out.push('\n');
        match message.role.as_str() {
            "user" => {
                out.push_str(&format!("## You\n\n{}\n", message.text));
            }
            "assistant" => {
                out.push_str(&format!("## Assistant\n\n{}\n", message.text));
            }
            "tool" => {
                let name = label_or(message.tool_name.as_deref(), "tool");
                out.push_str(&format!("**Tool call: {name}**\n\n{}", fenced_block(&message.text)));
            }
            "injected" => {
                let source = label_or(message.tool_name.as_deref(), "injected");
                out.push_str(&format!("> **{source}**\n>\n{}\n", blockquote(&message.text)));
            }
            "system" => {
                out.push_str(&format!("_{}_\n", message.text));
            }
            _ => {
                out.push_str(&format!("{}\n", message.text));
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary() -> SessionSummary {
        SessionSummary {
            id: "s1".into(),
            agent: "claude".into(),
            project_cwd: "/repo/app".into(),
            title: "Fix flaky test".into(),
            started_at: 1_751_328_000_000,
            ended_at: 1_751_500_800_000,
            message_count: 0,
            user_message_count: 0,
            output_tokens: None,
            model: None,
            file_path: "/f/s1.jsonl".into(),
            pinned: false,
        }
    }

    fn msg(role: &str, text: &str, tool_name: Option<&str>) -> TranscriptMessage {
        TranscriptMessage {
            role: role.to_string(),
            text: text.to_string(),
            timestamp: None,
            tool_name: tool_name.map(|s| s.to_string()),
        }
    }

    #[test]
    fn header_includes_title_agent_label_and_project() {
        let md = transcript_to_markdown(&summary(), &[]);
        assert!(md.starts_with("# Fix flaky test\n\n"));
        assert!(md.contains("Claude · `/repo/app` ·"));
    }

    #[test]
    fn empty_transcript_renders_header_only() {
        let md = transcript_to_markdown(&summary(), &[]);
        assert!(!md.contains("## You"));
        assert!(!md.contains("## Assistant"));
        // Header is "# title\n\nmeta\n" — three newlines, nothing after.
        assert_eq!(md.matches('\n').count(), 3);
        assert!(md.ends_with('\n') && !md.ends_with("\n\n"));
    }

    #[test]
    fn user_and_assistant_render_as_labelled_sections_with_verbatim_text() {
        let messages = vec![
            msg("user", "Why is this flaky?", None),
            msg("assistant", "Let me check.", None),
        ];
        let md = transcript_to_markdown(&summary(), &messages);
        assert!(md.contains("## You\n\nWhy is this flaky?\n"));
        assert!(md.contains("## Assistant\n\nLet me check.\n"));
    }

    #[test]
    fn tool_calls_render_as_a_fenced_block_labelled_with_the_tool_name() {
        let messages = vec![msg("tool", "{\"pattern\":\"flaky\"}", Some("grep"))];
        let md = transcript_to_markdown(&summary(), &messages);
        assert!(md.contains("**Tool call: grep**"));
        assert!(md.contains("```\n{\"pattern\":\"flaky\"}\n```\n"));
    }

    #[test]
    fn tool_call_missing_a_name_falls_back_to_a_generic_label() {
        let messages = vec![msg("tool", "output", None)];
        let md = transcript_to_markdown(&summary(), &messages);
        assert!(md.contains("**Tool call: tool**"));
    }

    #[test]
    fn tool_call_text_containing_a_fence_gets_a_longer_wrapping_fence() {
        // The tool's own text already contains a 3-backtick fenced block
        // (e.g. a write_file call echoing markdown); the wrapper must use a
        // longer fence or the embedded ``` would close it early.
        let text = "here is a fence:\n```\ncode\n```";
        let messages = vec![msg("tool", text, Some("write_file"))];
        let md = transcript_to_markdown(&summary(), &messages);
        let expected = "````\nhere is a fence:\n```\ncode\n```\n````\n";
        assert!(md.contains(expected), "expected block not found in:\n{md}");
    }

    #[test]
    fn injected_turns_render_as_a_blockquote_labelled_with_their_source() {
        let messages = vec![msg("injected", "line one\nline two", Some("teammate"))];
        let md = transcript_to_markdown(&summary(), &messages);
        assert!(md.contains("> **teammate**\n>\n> line one\n> line two\n"));
    }

    #[test]
    fn injected_turn_missing_a_source_falls_back_to_a_generic_label() {
        let messages = vec![msg("injected", "body", None)];
        let md = transcript_to_markdown(&summary(), &messages);
        assert!(md.contains("> **injected**"));
    }

    #[test]
    fn system_messages_render_as_an_italic_line() {
        let messages = vec![msg("system", "Session resumed.", None)];
        let md = transcript_to_markdown(&summary(), &messages);
        assert!(md.contains("_Session resumed._\n"));
    }

    #[test]
    fn tool_name_with_newlines_and_backticks_renders_as_a_single_clean_label_line() {
        // A corrupted transcript could carry markdown-structural characters
        // in tool_name; the label must stay on one line and must not open a
        // fence of its own, or the block structure below it breaks.
        let messages = vec![msg("tool", "output", Some("evil\n```\ninjected"))];
        let md = transcript_to_markdown(&summary(), &messages);
        assert!(md.contains("**Tool call: evil ''' injected**\n"), "label not sanitized in:\n{md}");
        // The real fence structure around the body is intact.
        assert!(md.contains("```\noutput\n```\n"));
    }

    #[test]
    fn injected_source_with_newlines_and_backticks_renders_as_a_single_clean_label_line() {
        let messages = vec![msg("injected", "body", Some("bad\r\n`source`"))];
        let md = transcript_to_markdown(&summary(), &messages);
        assert!(md.contains("> **bad 'source'**\n>\n> body\n"), "label not sanitized in:\n{md}");
    }

    #[test]
    fn whitespace_only_tool_name_falls_back_to_the_generic_label() {
        let messages = vec![msg("tool", "output", Some(" \n\t "))];
        let md = transcript_to_markdown(&summary(), &messages);
        assert!(md.contains("**Tool call: tool**\n"));
    }

    #[test]
    fn same_day_session_renders_a_single_date_instead_of_a_range() {
        let mut s = summary();
        // Two timestamps a few hours apart on the same local calendar day.
        s.ended_at = s.started_at + 3 * 60 * 60 * 1000;
        let md = transcript_to_markdown(&s, &[]);
        let date = super::local_date(s.started_at);
        assert!(md.contains(&format!("Claude · `/repo/app` · {date}\n")), "single date not found in:\n{md}");
        assert!(!md.contains(" – "));
    }
}
