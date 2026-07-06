//! Shared shapes for the sessions index: what parsers produce and what the
//! frontend receives. Timestamps are epoch milliseconds (UTC); activity
//! buckets use the local calendar so the heatmap matches the user's day.

/// One agent's parsed session, ready to upsert into the index.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedSession {
    pub id: String,
    /// "claude" | "codex" | "antigravity"
    pub agent: &'static str,
    pub project_cwd: String,
    pub title: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub message_count: i64,
    pub user_message_count: i64,
    /// None when the source format exposes no token counts.
    pub output_tokens: Option<i64>,
    pub model: Option<String>,
    /// Per local-day/hour message buckets, for the P2 heatmap.
    pub activity: Vec<ActivityBucket>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActivityBucket {
    /// Local date, "YYYY-MM-DD".
    pub date: String,
    pub hour: u8,
    pub messages: i64,
    pub user_messages: i64,
    pub output_tokens: i64,
}

/// What `sessions_list` returns to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub agent: String,
    pub project_cwd: String,
    pub title: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub message_count: i64,
    pub user_message_count: i64,
    pub output_tokens: Option<i64>,
    pub model: Option<String>,
    pub file_path: String,
    pub pinned: bool,
}

/// One rendered message for the viewer, re-parsed from the source file on
/// demand (the index never stores message bodies).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct TranscriptMessage {
    /// "user" | "assistant" | "tool" | "system"
    pub role: String,
    pub text: String,
    pub timestamp: Option<i64>,
    pub tool_name: Option<String>,
}
