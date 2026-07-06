# AI Sessions View P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sidebar "AI Sessions" view listing every historical Claude Code / Codex / Antigravity CLI session on this machine, with a main-area viewer tab, live-session section, pinning, and one-click resume.

**Architecture:** A new Rust module `sessions_index` scans the three agents' on-disk session stores, parses them defensively into a metadata-only SQLite index (message bodies are re-parsed from source files on demand), and watches the roots for changes. The frontend adds a sidebar view + one singleton "sessions" content tab (same pattern as `git-graph`).

**Tech Stack:** Rust (Tauri 2, rusqlite, notify 6, chrono, serde_json), React 19 + zustand + Tailwind v4, vitest.

**Spec:** `docs/superpowers/specs/2026-07-06-ai-sessions-view-design.md`

## Global Constraints

- **No new npm dependencies.** Charts and all UI are hand-rolled.
- **Only new Rust crate: `rusqlite`** — system SQLite on macOS, `bundled` feature on Windows/Linux only.
- Code comments, commit messages in **English**; all user-visible strings go through i18next with **both** `en` and `zh-Hant` values.
- Conventional commits (`feat:`, `test:`, `docs:` …). No AI attribution lines.
- All filesystem access happens in Rust commands (the app never uses `@tauri-apps/plugin-fs`).
- Session file formats are unofficial internals: **parse defensively** — a malformed line/blob is skipped, never an error that aborts a batch.
- The index DB is a disposable cache: schema mismatch ⇒ drop data tables and rebuild. Never treat it as a source of truth.
- Dialogs use the in-app components, never `window.confirm` / `alert`.
- Branch: `feat/ai-sessions-view` in the `tempo-term-dev` worktree. Base: `master`.

## Verified facts (do not re-derive)

- Claude sessions: `~/.claude/projects/<mangled-cwd>/*.jsonl` (only top-level `.jsonl` files; `<session-id>/` companion dirs contain subagents/tool-results). Lines carry `type`, `uuid`, `parentUuid`, `timestamp` (ISO 8601), `isMeta`, `isSidechain`, `cwd`, `sessionId`, `message.{role,content,model,usage}`. Env override `CLAUDE_CONFIG_DIR`.
- Codex sessions: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + `~/.codex/archived_sessions/*.jsonl`. Line shape `{timestamp, type, payload}` with types `session_meta` (payload.id, payload.cwd), `event_msg` (payload.type: `user_message` with `.message`, `token_count` with `.info`), `response_item` (payload.type `message` with `.role`/`.content[]`, `function_call` with `.name`), `turn_context`. Env override `CODEX_HOME`.
- Antigravity CLI: `~/.gemini/antigravity-cli/conversations/<uuid>.db` (SQLite + `-wal`/`-shm`). Verified real schema: `steps(idx INTEGER PK, step_type INTEGER, status, …, step_payload BLOB, step_format)`, `gen_metadata(idx INTEGER PK, data BLOB, size)`. step_type 14 = user input, 15 = planner (assistant) response. In `step_payload` protobuf: field 5 = google.protobuf.Timestamp (seconds=field 1, nanos=field 2), field 17 = message text.
- Existing patterns to copy: `src-tauri/src/modules/claude_progress/mod.rs` (watcher + tail + command + tests style), `codex_progress/mod.rs`. Reusable helpers already public enough: `claude_progress::{config_base_dir, extract_session_title}`.
- Tab plumbing: `TabKind`/`openGitGraphTab` in `src/stores/tabsStore.ts` (singleton content tab pattern), `PaneContent` union in `src/modules/terminal/lib/terminalLayout.ts:15`, render switch in `src/modules/terminal/PaneTabContent.tsx:460`, icon switch in `src/components/TabBar.tsx:62`, tab title i18n at `tabs.*` in `src/i18n/locales/{en,zh-Hant}/common.json` (key `"git-graph"` exists at line ~237).
- Run a command in a fresh terminal: `useTabsStore.getState().newTerminalTab(cwd)` then `writeToTerminal(leafId, "cmd\n")` from `src/modules/terminal/lib/terminalBus.ts` — writes queue until the PTY registers, so no race.
- Live status: `useSessionStatusStore` (`src/modules/claude-progress/lib/sessionStatusStore.ts`) — `statuses`/`agents` are `Record<leafId, …>`; map leafId→tab via `useTabsStore` + `computeLayout`.
- Test commands: Rust `cd src-tauri && cargo test <filter>`; frontend `pnpm test` (vitest run), `pnpm typecheck`.
- lib.rs wiring: `.manage(XState::new())` around `src-tauri/src/lib.rs:95-103`, command list in `tauri::generate_handler![ … ]` at `src-tauri/src/lib.rs:142`; module list in `src-tauri/src/modules/mod.rs`.

## File Structure

```
src-tauri/src/modules/sessions_index/
  mod.rs           state + 4 Tauri commands + event emit
  types.rs         ParsedSession / ActivityBucket / SessionSummary / TranscriptMessage
  index.rs         SQLite cache: schema, upsert, list, pin, lookup, prune
  scanner.rs       discover session files across the three roots
  claude.rs        Claude JSONL → ParsedSession / transcript (DAG main path)
  codex.rs         Codex rollout JSONL → ParsedSession / transcript
  antigravity.rs   Antigravity CLI .db → ParsedSession / transcript
  proto.rs         minimal protobuf wire-format reader (no prost)
  sync.rs          full + per-file sync orchestration
  watch.rs         notify watchers + 500 ms debounce thread

src/modules/sessions/
  SessionsPanel.tsx        sidebar view (Live / search / filters / pins / list)
  SessionsTabContent.tsx   main-area tab (empty state ↔ transcript viewer)
  lib/sessionsBridge.ts    invoke + event wrappers, TS types
  lib/sessionsStore.ts     zustand store (list, filters, selection)
  lib/sessionsStore.test.ts
  lib/liveSessions.ts      derive live entries from tabs + status stores
  lib/liveSessions.test.ts
  lib/resume.ts            open terminal tab + type resume command
  lib/relativeTime.ts (+test)

Modified: src-tauri/Cargo.toml, src-tauri/src/lib.rs, src-tauri/src/modules/mod.rs,
src/stores/uiStore.ts, src/stores/tabsStore.ts, src/components/Sidebar.tsx,
src/components/TabBar.tsx, src/modules/terminal/lib/terminalLayout.ts,
src/modules/terminal/PaneTabContent.tsx, src/i18n/locales/{en,zh-Hant}/common.json
```

---

### Task 1: rusqlite dependency + module skeleton + shared types

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/modules/mod.rs`
- Create: `src-tauri/src/modules/sessions_index/mod.rs`
- Create: `src-tauri/src/modules/sessions_index/types.rs`

**Interfaces:**
- Produces: `ParsedSession`, `ActivityBucket`, `SessionSummary`, `TranscriptMessage` — every later task uses these exact shapes.

- [ ] **Step 1: Add rusqlite to Cargo.toml**

In `[dependencies]` (after `notify = "6"`):

```toml
# Reads the Antigravity CLI's per-session SQLite trajectory databases and backs
# the sessions index cache. macOS links the system libsqlite3 to keep the
# binary lean; Windows/Linux have no system SQLite so they compile it in.
rusqlite = "0.32"
```

And target-specific feature additions (append to the existing `[target.'cfg(target_os = "windows")'.dependencies]` block, and to the linux one):

```toml
# in [target.'cfg(target_os = "windows")'.dependencies]
rusqlite = { version = "0.32", features = ["bundled"] }

# in [target.'cfg(target_os = "linux")'.dependencies]
rusqlite = { version = "0.32", features = ["bundled"] }
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/modules/mod.rs` add (alphabetical order, near `session_log`):

```rust
pub mod sessions_index;
```

- [ ] **Step 3: Create types.rs**

```rust
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
```

- [ ] **Step 4: Create mod.rs (skeleton only for now)**

```rust
//! Historical AI CLI sessions: scans Claude Code / Codex / Antigravity CLI
//! session stores into a metadata-only SQLite index and serves the sidebar
//! sessions view. Message bodies are re-parsed from source files on demand —
//! the index is a disposable cache, the files stay the source of truth.

pub mod antigravity;
pub mod claude;
pub mod codex;
pub mod index;
pub mod proto;
pub mod scanner;
pub mod sync;
pub mod types;
pub mod watch;
```

(Create empty placeholder files `index.rs`, `scanner.rs`, `claude.rs`, `codex.rs`, `antigravity.rs`, `proto.rs`, `sync.rs`, `watch.rs` each containing only a module doc-comment so the build passes; each later task fills its file.)

- [ ] **Step 5: Verify build**

Run: `cd src-tauri && cargo check`
Expected: success (warnings about unused code are fine at this point).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/modules/mod.rs src-tauri/src/modules/sessions_index
git commit -m "feat(sessions): add sessions_index module skeleton and rusqlite dependency"
```

---

### Task 2: SQLite index layer

**Files:**
- Create: `src-tauri/src/modules/sessions_index/index.rs` (tests inline `#[cfg(test)]`)

**Interfaces:**
- Consumes: `types::{ParsedSession, SessionSummary}`
- Produces:
  - `Index::open(path: &Path) -> Result<Index, String>`
  - `Index::upsert_session(&self, s: &ParsedSession, file_path: &str, file_mtime: i64, file_size: i64) -> Result<(), String>`
  - `Index::needs_sync(&self, file_path: &str, file_mtime: i64, file_size: i64) -> bool`
  - `Index::list(&self) -> Vec<SessionSummary>` (newest `ended_at` first)
  - `Index::set_pinned(&self, id: &str, pinned: bool) -> Result<(), String>`
  - `Index::lookup_file(&self, id: &str) -> Option<(String, String)>` (agent, file_path)
  - `Index::prune_missing(&self, existing: &std::collections::HashSet<String>) -> Result<(), String>`

- [ ] **Step 1: Write failing tests** (inline in `index.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::sessions_index::types::{ActivityBucket, ParsedSession};

    fn sample(id: &str) -> ParsedSession {
        ParsedSession {
            id: id.into(),
            agent: "claude",
            project_cwd: "/tmp/proj".into(),
            title: "hello".into(),
            started_at: 1000,
            ended_at: 2000,
            message_count: 4,
            user_message_count: 2,
            output_tokens: Some(50),
            model: Some("claude-sonnet-5".into()),
            activity: vec![ActivityBucket {
                date: "2026-07-06".into(),
                hour: 9,
                messages: 4,
                user_messages: 2,
                output_tokens: 50,
            }],
        }
    }

    fn temp_db(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tt-sessions-index-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("index.db")
    }

    #[test]
    fn upsert_then_list_roundtrips_a_session() {
        let index = Index::open(&temp_db("roundtrip")).unwrap();
        index.upsert_session(&sample("s1"), "/f/s1.jsonl", 111, 222).unwrap();
        let rows = index.list();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "s1");
        assert_eq!(rows[0].agent, "claude");
        assert_eq!(rows[0].message_count, 4);
        assert_eq!(rows[0].file_path, "/f/s1.jsonl");
        assert!(!rows[0].pinned);
    }

    #[test]
    fn upsert_replaces_instead_of_duplicating() {
        let index = Index::open(&temp_db("replace")).unwrap();
        index.upsert_session(&sample("s1"), "/f/s1.jsonl", 1, 1).unwrap();
        let mut updated = sample("s1");
        updated.message_count = 9;
        index.upsert_session(&updated, "/f/s1.jsonl", 2, 2).unwrap();
        let rows = index.list();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].message_count, 9);
    }

    #[test]
    fn needs_sync_is_false_only_for_unchanged_fingerprint() {
        let index = Index::open(&temp_db("fingerprint")).unwrap();
        index.upsert_session(&sample("s1"), "/f/s1.jsonl", 111, 222).unwrap();
        assert!(!index.needs_sync("/f/s1.jsonl", 111, 222));
        assert!(index.needs_sync("/f/s1.jsonl", 112, 222));
        assert!(index.needs_sync("/f/s1.jsonl", 111, 223));
        assert!(index.needs_sync("/f/other.jsonl", 111, 222));
    }

    #[test]
    fn pins_survive_and_order_is_newest_first() {
        let index = Index::open(&temp_db("pins")).unwrap();
        index.upsert_session(&sample("old"), "/f/a.jsonl", 1, 1).unwrap();
        let mut newer = sample("new");
        newer.ended_at = 9999;
        index.upsert_session(&newer, "/f/b.jsonl", 1, 1).unwrap();
        index.set_pinned("old", true).unwrap();
        let rows = index.list();
        assert_eq!(rows[0].id, "new");
        assert!(rows.iter().find(|r| r.id == "old").unwrap().pinned);
    }

    #[test]
    fn lookup_file_returns_agent_and_path() {
        let index = Index::open(&temp_db("lookup")).unwrap();
        index.upsert_session(&sample("s1"), "/f/s1.jsonl", 1, 1).unwrap();
        assert_eq!(
            index.lookup_file("s1"),
            Some(("claude".to_string(), "/f/s1.jsonl".to_string()))
        );
        assert_eq!(index.lookup_file("nope"), None);
    }

    #[test]
    fn prune_missing_drops_sessions_whose_file_is_gone() {
        let index = Index::open(&temp_db("prune")).unwrap();
        index.upsert_session(&sample("s1"), "/f/a.jsonl", 1, 1).unwrap();
        index.upsert_session(&sample("s2"), "/f/b.jsonl", 1, 1).unwrap();
        let existing: std::collections::HashSet<String> = ["/f/a.jsonl".to_string()].into();
        index.prune_missing(&existing).unwrap();
        let rows = index.list();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "s1");
    }

    #[test]
    fn schema_version_bump_rebuilds_data_but_keeps_pins() {
        let path = temp_db("version");
        {
            let index = Index::open(&path).unwrap();
            index.upsert_session(&sample("s1"), "/f/a.jsonl", 1, 1).unwrap();
            index.set_pinned("s1", true).unwrap();
            index.conn.execute("UPDATE meta SET value='0' WHERE key='schema_version'", []).unwrap();
        }
        let reopened = Index::open(&path).unwrap();
        assert!(reopened.list().is_empty()); // data table was rebuilt
        // pins table persisted; re-upserting the session shows it pinned again
        reopened.upsert_session(&sample("s1"), "/f/a.jsonl", 1, 1).unwrap();
        assert!(reopened.list()[0].pinned);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test sessions_index::index`
Expected: compile error (`Index` not defined).

- [ ] **Step 3: Implement**

```rust
//! The metadata index: a disposable SQLite cache of session summaries and
//! per-day activity buckets. Message bodies are never stored here. If the
//! schema version doesn't match, data tables are dropped and rebuilt from
//! source files; the pins table survives rebuilds because it's user state.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::{params, Connection};

use super::types::{ParsedSession, SessionSummary};

pub const SCHEMA_VERSION: &str = "1";

pub struct Index {
    pub(crate) conn: Connection,
}

impl Index {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
        let index = Self { conn };
        index.migrate()?;
        Ok(index)
    }

    fn migrate(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 CREATE TABLE IF NOT EXISTS pins(session_id TEXT PRIMARY KEY);",
            )
            .map_err(|e| e.to_string())?;
        let version: Option<String> = self
            .conn
            .query_row("SELECT value FROM meta WHERE key='schema_version'", [], |r| r.get(0))
            .ok();
        if version.as_deref() != Some(SCHEMA_VERSION) {
            // Stale or missing schema: drop derived data (cheap to rebuild from
            // source files) but keep pins (user state with no other home).
            self.conn
                .execute_batch("DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS activity;")
                .map_err(|e| e.to_string())?;
        }
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS sessions(
                   id TEXT PRIMARY KEY,
                   agent TEXT NOT NULL,
                   project_cwd TEXT NOT NULL,
                   title TEXT NOT NULL,
                   started_at INTEGER NOT NULL,
                   ended_at INTEGER NOT NULL,
                   message_count INTEGER NOT NULL,
                   user_message_count INTEGER NOT NULL,
                   output_tokens INTEGER,
                   model TEXT,
                   file_path TEXT NOT NULL,
                   file_mtime INTEGER NOT NULL,
                   file_size INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_sessions_file ON sessions(file_path);
                 CREATE TABLE IF NOT EXISTS activity(
                   session_id TEXT NOT NULL,
                   date TEXT NOT NULL,
                   hour INTEGER NOT NULL,
                   messages INTEGER NOT NULL,
                   user_messages INTEGER NOT NULL,
                   output_tokens INTEGER NOT NULL,
                   PRIMARY KEY(session_id, date, hour)
                 );",
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "INSERT INTO meta(key,value) VALUES('schema_version',?1)
                 ON CONFLICT(key) DO UPDATE SET value=?1",
                params![SCHEMA_VERSION],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn upsert_session(
        &self,
        s: &ParsedSession,
        file_path: &str,
        file_mtime: i64,
        file_size: i64,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO sessions(id,agent,project_cwd,title,started_at,ended_at,
                   message_count,user_message_count,output_tokens,model,file_path,file_mtime,file_size)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
                 ON CONFLICT(id) DO UPDATE SET agent=?2,project_cwd=?3,title=?4,started_at=?5,
                   ended_at=?6,message_count=?7,user_message_count=?8,output_tokens=?9,model=?10,
                   file_path=?11,file_mtime=?12,file_size=?13",
                params![
                    s.id, s.agent, s.project_cwd, s.title, s.started_at, s.ended_at,
                    s.message_count, s.user_message_count, s.output_tokens, s.model,
                    file_path, file_mtime, file_size
                ],
            )
            .map_err(|e| e.to_string())?;
        // Activity rows are keyed by session id and replaced wholesale with the
        // session, so a whole-file re-parse can never double-count a bucket.
        self.conn
            .execute("DELETE FROM activity WHERE session_id=?1", params![s.id])
            .map_err(|e| e.to_string())?;
        for b in &s.activity {
            self.conn
                .execute(
                    "INSERT INTO activity(session_id,date,hour,messages,user_messages,output_tokens)
                     VALUES(?1,?2,?3,?4,?5,?6)",
                    params![s.id, b.date, b.hour, b.messages, b.user_messages, b.output_tokens],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// True when the file is unknown or its mtime/size fingerprint changed.
    pub fn needs_sync(&self, file_path: &str, file_mtime: i64, file_size: i64) -> bool {
        let known: Option<(i64, i64)> = self
            .conn
            .query_row(
                "SELECT file_mtime, file_size FROM sessions WHERE file_path=?1 LIMIT 1",
                params![file_path],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        known != Some((file_mtime, file_size))
    }

    pub fn list(&self) -> Vec<SessionSummary> {
        let mut stmt = match self.conn.prepare(
            "SELECT s.id,s.agent,s.project_cwd,s.title,s.started_at,s.ended_at,
                    s.message_count,s.user_message_count,s.output_tokens,s.model,s.file_path,
                    (p.session_id IS NOT NULL) AS pinned
             FROM sessions s LEFT JOIN pins p ON p.session_id = s.id
             ORDER BY s.ended_at DESC",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map([], |r| {
            Ok(SessionSummary {
                id: r.get(0)?,
                agent: r.get(1)?,
                project_cwd: r.get(2)?,
                title: r.get(3)?,
                started_at: r.get(4)?,
                ended_at: r.get(5)?,
                message_count: r.get(6)?,
                user_message_count: r.get(7)?,
                output_tokens: r.get(8)?,
                model: r.get(9)?,
                file_path: r.get(10)?,
                pinned: r.get(11)?,
            })
        });
        match rows {
            Ok(iter) => iter.flatten().collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), String> {
        let sql = if pinned {
            "INSERT OR IGNORE INTO pins(session_id) VALUES(?1)"
        } else {
            "DELETE FROM pins WHERE session_id=?1"
        };
        self.conn.execute(sql, params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn lookup_file(&self, id: &str) -> Option<(String, String)> {
        self.conn
            .query_row(
                "SELECT agent, file_path FROM sessions WHERE id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok()
    }

    /// Drop sessions whose source file no longer exists on disk.
    pub fn prune_missing(&self, existing: &HashSet<String>) -> Result<(), String> {
        let paths: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT DISTINCT file_path FROM sessions")
                .map_err(|e| e.to_string())?;
            let iter = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            iter.flatten().collect()
        };
        for path in paths {
            if !existing.contains(&path) {
                self.conn
                    .execute("DELETE FROM activity WHERE session_id IN (SELECT id FROM sessions WHERE file_path=?1)", params![path])
                    .map_err(|e| e.to_string())?;
                self.conn
                    .execute("DELETE FROM sessions WHERE file_path=?1", params![path])
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test sessions_index::index`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/sessions_index
git commit -m "feat(sessions): SQLite metadata index with pins and rebuild-on-version-bump"
```

---

### Task 3: Claude parser

**Files:**
- Create: `src-tauri/src/modules/sessions_index/claude.rs`

**Interfaces:**
- Consumes: `types::{ParsedSession, ActivityBucket, TranscriptMessage}`, `claude_progress::extract_session_title`
- Produces:
  - `pub fn parse_claude_meta(path: &Path) -> Option<ParsedSession>`
  - `pub fn parse_claude_transcript(path: &Path) -> Vec<TranscriptMessage>`
  - `pub(crate) fn epoch_ms(iso: &str) -> Option<i64>` and `pub(crate) fn local_bucket(ms: i64) -> (String, u8)` — codex.rs reuses both.

**Parsing rules (port of agentsview's logic, simplified):**
- Only lines whose `type` is `user`/`assistant` with a non-empty `message` count as messages. Skip `isMeta == true` and `isSidechain == true` lines. Skip user lines whose content holds only `tool_result` items (no text).
- DAG main path: entries carry `uuid`/`parentUuid`. Build a children map; start from the first root (no parent, or parent unknown); at a fork, if the subtree under the *first* child contains ≤ 3 user messages, follow the *last* child (small retry gap), otherwise follow the first child. If any user/assistant line lacks a `uuid`, fall back to linear order.
- `project_cwd`: first line with a non-empty `cwd` field; fallback: parent dir name.
- Session id: first line's `sessionId`; fallback: file stem.
- Title: `claude_progress::extract_session_title` on the full contents.
- Tokens: sum of assistant `message.usage.output_tokens`. Model: last assistant `message.model`.
- Timestamps: min/max `timestamp` across all lines (even skipped ones).

- [ ] **Step 1: Write failing tests** (inline; build JSONL fixtures with `concat!` like `claude_progress` tests)

```rust
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
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test sessions_index::claude`
Expected: compile error (functions not defined).

- [ ] **Step 3: Implement**

Implementation outline (write full code following these exact semantics; keep every helper `fn` small and unit-testable):

```rust
//! Claude Code JSONL parser: walks the uuid/parentUuid DAG's main path and
//! produces session metadata and viewer transcripts. Ported (simplified) from
//! agentsview's claude parser (MIT); see the design spec for the rules.

use std::path::Path;

use chrono::{DateTime, Datelike, Local, Timelike};
use serde_json::Value;

use super::types::{ActivityBucket, ParsedSession, TranscriptMessage};

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

struct Entry {
    uuid: Option<String>,
    parent: Option<String>,
    value: Value,
}

// 1. read_to_string; parse each line into Entry (skip unparseable lines).
// 2. is_countable(value): type is user/assistant, !isMeta, !isSidechain, and
//    message content has a text item / tool_use item (user tool_result-only → false).
// 3. main_path(entries) -> Vec<usize>:
//    - if any countable entry lacks uuid → return linear order (all indices).
//    - children: HashMap<parent-uuid, Vec<index>> in file order; roots = entries
//      whose parent is None or unknown. Walk from first root; at each node push
//      index, then among children: if user_turns_under(first_child) <= FORK_USER_TURN_THRESHOLD
//      → descend last child, else descend first child.
//    - user_turns_under(i): DFS counting countable user entries.
// 4. parse_claude_meta: fold main-path entries into counts/tokens/model;
//    timestamps min/max over ALL lines; activity buckets from countable
//    main-path entries via local_bucket(ts); title via
//    crate::modules::claude_progress::extract_session_title(&contents);
//    id from first sessionId, else file stem; cwd from first non-empty cwd,
//    else parent dir name. Return None when there are no countable messages.
// 5. parse_claude_transcript: main-path entries → TranscriptMessage list:
//    - user text → role "user" (join text items with \n)
//    - assistant content items in order: text → role "assistant";
//      tool_use → role "tool", tool_name = item.name, text = compact JSON of
//      item.input truncated to 400 chars.
```

- [ ] **Step 4: Run tests until green**

Run: `cd src-tauri && cargo test sessions_index::claude`
Expected: all 5 tests PASS.

- [ ] **Step 5: Sanity check against real data** (manual, not a unit test)

Add a temporary `#[test] #[ignore]` that parses the newest real transcript and prints the meta, then:
Run: `cd src-tauri && cargo test sessions_index::claude -- --ignored --nocapture`
Expected: plausible title/counts for a real session. Delete or keep the ignored test (keep is fine — it only runs on demand).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/modules/sessions_index/claude.rs
git commit -m "feat(sessions): Claude JSONL parser with DAG main-path selection"
```

---

### Task 4: Codex parser

**Files:**
- Create: `src-tauri/src/modules/sessions_index/codex.rs`

**Interfaces:**
- Consumes: `claude::{epoch_ms, local_bucket}`, `types::*`
- Produces: `pub fn parse_codex_meta(path: &Path) -> Option<ParsedSession>`, `pub fn parse_codex_transcript(path: &Path) -> Vec<TranscriptMessage>`

**Parsing rules** (before implementing, skim `src/modules/claude-progress/lib/codexNormalize.ts` to keep event interpretation consistent with the live-progress path):
- `session_meta` → id = `payload.id`, cwd = `payload.cwd`, started_at = its `timestamp`.
- User messages: `event_msg` with `payload.type == "user_message"` → text `payload.message`. (Do **not** also count `response_item` `role:"user"` — the rollout replays them; counting both double-counts.)
- Assistant messages: `response_item` with `payload.type == "message"` and `payload.role == "assistant"` → join `payload.content[]` items' `.text` fields.
- Tool calls: `response_item` with `payload.type == "function_call"` → role "tool", tool_name = `payload.name`.
- Skip `response_item` `role` `developer`/`system`.
- Tokens: `event_msg` with `payload.type == "token_count"` → keep the **last** `payload.info.total_token_usage.output_tokens` (cumulative). All accesses defensive; absent ⇒ `None`.
- Model: last `turn_context` `payload.model` when present.
- Title: first user message text, trimmed, truncated to 80 chars.
- ended_at: max line `timestamp`.

- [ ] **Step 1: Discover the real token_count shape** (grounding step, 2 min)

Run: `grep -h '"token_count"' ~/.codex/sessions/2026/*/*/rollout-*.jsonl 2>/dev/null | tail -1 | python3 -m json.tool | head -40`
Expected: one event; confirm the path `payload.info.total_token_usage.output_tokens` (adjust the implementation + fixture to the real shape if it differs — record the actual shape in a code comment).

- [ ] **Step 2: Write failing tests**

```rust
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
}
```

- [ ] **Step 3: Run to verify failure, then implement**

Run: `cd src-tauri && cargo test sessions_index::codex` → compile error → implement per the rules above (single pass over lines, defensive `.get()` chains, reuse `epoch_ms`/`local_bucket`). Session with zero user and zero assistant messages ⇒ return `None`.

- [ ] **Step 4: Run tests until green**

Run: `cd src-tauri && cargo test sessions_index::codex`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/sessions_index/codex.rs
git commit -m "feat(sessions): Codex rollout JSONL parser"
```

---

### Task 5: Protobuf wire reader

**Files:**
- Create: `src-tauri/src/modules/sessions_index/proto.rs`

**Interfaces:**
- Produces:
  - `pub enum ProtoValue { Varint(u64), Fixed64(u64), Bytes(Vec<u8>), Fixed32(u32) }`
  - `pub fn parse_fields(buf: &[u8]) -> Vec<(u32, ProtoValue)>` (best-effort; stops at the first malformed byte)
  - `pub fn first_bytes<'a>(fields: &'a [(u32, ProtoValue)], field_no: u32) -> Option<&'a [u8]>`
  - `pub fn first_varint(fields: &[(u32, ProtoValue)], field_no: u32) -> Option<u64>`
  - `pub fn timestamp_ms(fields: &[(u32, ProtoValue)], field_no: u32) -> Option<i64>` (nested Timestamp: seconds field 1 varint, nanos field 2 varint)

- [ ] **Step 1: Write failing tests** — include a tiny test-only encoder so fixtures are readable:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Test-only encoder helpers (wire format: tag = field_no << 3 | wire_type).
    fn varint(mut v: u64, out: &mut Vec<u8>) {
        loop {
            let byte = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 { out.push(byte); break; }
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

    #[test]
    fn parses_varint_and_length_delimited_fields() {
        let mut buf = Vec::new();
        field_varint(3, 150, &mut buf);
        field_bytes(17, b"hello", &mut buf);
        let fields = parse_fields(&buf);
        assert_eq!(first_varint(&fields, 3), Some(150));
        assert_eq!(first_bytes(&fields, 17), Some(&b"hello"[..]));
    }

    #[test]
    fn decodes_a_nested_timestamp() {
        let mut ts = Vec::new();
        field_varint(1, 1_751_760_000, &mut ts); // seconds
        field_varint(2, 500_000_000, &mut ts);   // nanos
        let mut buf = Vec::new();
        field_bytes(5, &ts, &mut buf);
        let fields = parse_fields(&buf);
        assert_eq!(timestamp_ms(&fields, 5), Some(1_751_760_000_500));
    }

    #[test]
    fn malformed_input_yields_partial_fields_not_panic() {
        let mut buf = Vec::new();
        field_varint(1, 7, &mut buf);
        buf.extend_from_slice(&[0xff, 0xff]); // truncated garbage tail
        let fields = parse_fields(&buf);
        assert_eq!(first_varint(&fields, 1), Some(7));
    }

    #[test]
    fn skips_fixed32_and_fixed64_without_losing_position() {
        let mut buf = Vec::new();
        varint((2 << 3) | 1, &mut buf); buf.extend_from_slice(&8u64.to_le_bytes());
        varint((4 << 3) | 5, &mut buf); buf.extend_from_slice(&9u32.to_le_bytes());
        field_varint(6, 1, &mut buf);
        let fields = parse_fields(&buf);
        assert_eq!(first_varint(&fields, 6), Some(1));
    }
}
```

- [ ] **Step 2: Run to verify failure, then implement** — a cursor over `&[u8]` reading varint tags; wire types 0/1/2/5; any decode error (overlong varint, length past end) ⇒ return the fields collected so far.

- [ ] **Step 3: Run tests until green**

Run: `cd src-tauri && cargo test sessions_index::proto`
Expected: 4 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/modules/sessions_index/proto.rs
git commit -m "feat(sessions): minimal protobuf wire-format reader"
```

---

### Task 6: Antigravity parser (includes the gen_metadata spike)

**Files:**
- Create: `src-tauri/src/modules/sessions_index/antigravity.rs`

**Interfaces:**
- Consumes: `proto::*`, `claude::local_bucket`, `types::*`, rusqlite
- Produces: `pub fn parse_antigravity_meta(path: &Path) -> Option<ParsedSession>`, `pub fn parse_antigravity_transcript(path: &Path) -> Vec<TranscriptMessage>`

**Rules:**
- Open read-only: `Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX)`. A locked/corrupt DB ⇒ `None` (sync retries next round).
- `SELECT idx, step_type, step_payload FROM steps ORDER BY idx` — step_type 14 ⇒ user, 15 ⇒ assistant; payload field 17 = text, field 5 = timestamp. Steps with other types are ignored.
- Session id = file stem (the `<uuid>`). project_cwd = "" (Antigravity CLI does not expose a cwd here; the sidebar shows the agent badge instead of a project for these).
- Title = first user step's text (trim, 80 chars). Sessions with no user/assistant steps ⇒ `None`.
- Tokens/model: **spike step below decides**; ship `None` when fields can't be confidently identified.

- [ ] **Step 1: Spike — dump real gen_metadata blobs** (time-box ~30 min)

Write an `#[ignore]`d test `dump_real_gen_metadata` that opens 2–3 real DBs from `~/.gemini/antigravity-cli/conversations/`, runs `parse_fields` on each `gen_metadata.data` blob, and prints per-field: field number, wire type, varint value / UTF-8 preview.
Run: `cd src-tauri && cargo test sessions_index::antigravity -- --ignored --nocapture`
Decide from the output: which field holds the model string (expect something like `gemini-3-pro`), which nested message holds input/output token varints. Record findings as code comments on the extraction fn. **If not identifiable within the time box: leave `model=None, output_tokens=None` and move on** (documented degradation per spec).

- [ ] **Step 2: Write failing tests** — build a fixture DB in the test with rusqlite, encoding payloads with the same test-only encoder pattern as proto.rs (copy the 3 helper fns into this test module):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};

    // (varint / field_varint / field_bytes helpers copied from proto.rs tests)

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
}
```

- [ ] **Step 3: Run to verify failure, then implement** (query steps; decode payloads with proto helpers; skip steps whose payload lacks field 17 text; timestamps fall back to file mtime when field 5 is absent; wire the token/model extraction per the spike's findings).

- [ ] **Step 4: Run tests until green**

Run: `cd src-tauri && cargo test sessions_index::antigravity`
Expected: 3 tests PASS (plus the ignored dump test).

- [ ] **Step 5: Sanity check against a real conversation DB** via the ignored dump test output (titles/messages look right).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/modules/sessions_index/antigravity.rs
git commit -m "feat(sessions): Antigravity CLI trajectory DB parser"
```

---

### Task 7: Scanner

**Files:**
- Create: `src-tauri/src/modules/sessions_index/scanner.rs`

**Interfaces:**
- Consumes: `claude_progress::config_base_dir`
- Produces:
  - `#[derive(Debug, Clone, PartialEq)] pub struct SessionFile { pub agent: &'static str, pub path: PathBuf }`
  - `pub fn roots(home: &Path) -> Vec<(&'static str, PathBuf)>` — resolved (agent, root dir) pairs honoring `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `ANTIGRAVITY_CLI_DIR`; claude root is `<base>/projects`, codex roots are `<home>/.codex/sessions` and `<home>/.codex/archived_sessions`, antigravity root is `<dir>/conversations`.
  - `pub fn discover(home: &Path) -> Vec<SessionFile>`

**Rules:**
- Claude: for each subdir of `projects/`, every top-level `*.jsonl` file (never recurse into `<session-id>/` subdirs).
- Codex: recurse `sessions/` up to 3 nested dirs (YYYY/MM/DD) collecting `rollout-*.jsonl`; plus flat `archived_sessions/*.jsonl`.
- Antigravity: `conversations/*.db` only (skip `-wal`/`-shm`/`.db-journal`).
- Missing roots ⇒ contribute nothing (no error).

- [ ] **Step 1: Write failing tests** — build a fake home dir in temp with the three trees (a few files each, plus decoys: a subdir jsonl under a claude session dir, a `-wal` file), assert `discover` returns exactly the expected set with the right agents.

- [ ] **Step 2: Run to verify failure, then implement** (plain `read_dir` loops; a small recursive helper for codex with a depth limit of 4).

- [ ] **Step 3: Run tests until green**

Run: `cd src-tauri && cargo test sessions_index::scanner`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/modules/sessions_index/scanner.rs
git commit -m "feat(sessions): session file discovery across three agent roots"
```

---

### Task 8: Sync + watcher + Tauri commands + registration

**Files:**
- Create: `src-tauri/src/modules/sessions_index/sync.rs`
- Create: `src-tauri/src/modules/sessions_index/watch.rs`
- Modify: `src-tauri/src/modules/sessions_index/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: everything above.
- Produces (frontend contract):
  - Commands: `sessions_index_start()`, `sessions_list() -> Vec<SessionSummary>`, `sessions_get(id: String) -> Vec<TranscriptMessage>`, `sessions_pin(id: String, pinned: bool)`
  - Event `"sessions-index:updated"` with payload `{ "count": number }` after every sync batch.
  - State: `pub struct SessionsIndexState` (managed in lib.rs).

- [ ] **Step 1: Write failing tests for sync.rs** — pure parts only:

```rust
// sync_file(index, agent, path) -> bool  (true when something was upserted)
// - stats the file; skips via index.needs_sync; dispatches to the right parser;
//   upserts on Some. Antigravity fingerprint: mtime/size of .db + companions
//   (-wal/-shm) summed, via fingerprint(path) helper.
// Tests: temp dir + fixture jsonl (reuse Task 3's BASIC constant semantics):
//   1) first sync_file returns true and index.list() has the session,
//   2) second sync_file without changes returns false (skip cache),
//   3) touching the file (rewrite with +1 line) re-syncs.
// full_sync(index, home) -> usize: discover + sync each + prune_missing.
//   Test with a fake home from Task 7's fixture builder: after deleting one
//   file and re-running full_sync, its session is gone.
```

- [ ] **Step 2: Implement sync.rs** — `fingerprint(path: &Path) -> (i64, i64)` (mtime ms + size; for `.db` add companions' mtime/size so WAL-only commits change the fingerprint), `sync_file`, `full_sync`. All errors swallowed per-file (log with `eprintln!` only in debug).

- [ ] **Step 3: Implement watch.rs** (thin, hard to unit test — keep logic minimal and lean on the debounced-drain being trivially readable):

```rust
//! Watches the three agent roots and re-syncs changed files, debounced.
//! One mpsc channel; notify callbacks push paths; a worker thread drains with
//! recv_timeout(500ms) batches, maps each path to its agent by root prefix
//! (a -wal/-shm path maps back to its .db), syncs, then emits one
//! "sessions-index:updated" event per batch.
```

Watchers: claude projects root **recursive** (new project dirs appear), codex `sessions` recursive + `archived_sessions` non-recursive, antigravity `conversations` non-recursive. Store `Vec<RecommendedWatcher>` in state to keep subscriptions alive. Roots that don't exist are skipped.

- [ ] **Step 4: Implement mod.rs state + commands**

```rust
pub struct SessionsIndexState {
    inner: std::sync::Arc<std::sync::Mutex<Option<StateInner>>>,
}
struct StateInner {
    index: std::sync::Arc<std::sync::Mutex<index::Index>>,
    _watchers: Vec<notify::RecommendedWatcher>,
}

#[tauri::command]
pub fn sessions_index_start(app: tauri::AppHandle, state: tauri::State<SessionsIndexState>) -> Result<(), String>
// - no-op if already started
// - db path: app.path().app_data_dir()?.join("sessions-index.db")
// - open index; spawn a thread doing full_sync(home) then emit updated event
// - start watch::start(app, index_arc) and stash watchers

#[tauri::command]
pub fn sessions_list(state: tauri::State<SessionsIndexState>) -> Vec<types::SessionSummary>
// empty vec when not started

#[tauri::command]
pub async fn sessions_get(state: tauri::State<'_, SessionsIndexState>, id: String) -> Result<Vec<types::TranscriptMessage>, String>
// lookup_file → dispatch parse_*_transcript on a spawn_blocking thread
// (transcripts can be MBs; never parse on the main thread)

#[tauri::command]
pub fn sessions_pin(state: tauri::State<SessionsIndexState>, id: String, pinned: bool) -> Result<(), String>
```

- [ ] **Step 5: Register in lib.rs** — add `.manage(SessionsIndexState::new())` beside the other `.manage(...)` calls (`src-tauri/src/lib.rs:95-103`), add the four command names to `generate_handler![...]` (`src-tauri/src/lib.rs:142`), and the matching `use` alongside the other `use modules::...` imports.

- [ ] **Step 6: Run the full Rust suite**

Run: `cd src-tauri && cargo test sessions_index && cargo check`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src
git commit -m "feat(sessions): sync engine, filesystem watchers, and Tauri commands"
```

---

### Task 9: TS bridge + store

**Files:**
- Create: `src/modules/sessions/lib/sessionsBridge.ts`
- Create: `src/modules/sessions/lib/sessionsStore.ts`
- Create: `src/modules/sessions/lib/sessionsStore.test.ts`
- Create: `src/modules/sessions/lib/relativeTime.ts`, `src/modules/sessions/lib/relativeTime.test.ts`

**Interfaces (produces — later tasks import these exact names):**

```ts
// sessionsBridge.ts
export type SessionAgent = "claude" | "codex" | "antigravity";
export interface SessionSummary {
  id: string; agent: SessionAgent; project_cwd: string; title: string;
  started_at: number; ended_at: number; message_count: number;
  user_message_count: number; output_tokens: number | null;
  model: string | null; file_path: string; pinned: boolean;
}
export interface TranscriptMessage {
  role: "user" | "assistant" | "tool" | "system";
  text: string; timestamp: number | null; tool_name: string | null;
}
export function sessionsStart(): Promise<void>;           // invoke("sessions_index_start")
export function sessionsList(): Promise<SessionSummary[]>; // invoke("sessions_list")
export function sessionsGet(id: string): Promise<TranscriptMessage[]>;
export function sessionsPin(id: string, pinned: boolean): Promise<void>;
export function onSessionsUpdated(cb: () => void): Promise<() => void>; // listen("sessions-index:updated")

// sessionsStore.ts (zustand, same style as other stores)
interface SessionsState {
  sessions: SessionSummary[];
  loaded: boolean;
  query: string;
  agentFilter: SessionAgent | "all";
  selectedId: string | null;
  refresh(): Promise<void>;                 // sessionsList → set
  start(): Promise<void>;                   // sessionsStart + refresh
  setQuery(q: string): void;
  setAgentFilter(f: SessionAgent | "all"): void;
  select(id: string | null): void;
  togglePin(id: string): Promise<void>;     // optimistic flip + sessionsPin + refresh on error
}
export const useSessionsStore: UseBoundStore<StoreApi<SessionsState>>;
// Pure selector, exported for tests and the panel:
export function visibleSessions(sessions: SessionSummary[], query: string, agentFilter: SessionAgent | "all"):
  { pinned: SessionSummary[]; history: SessionSummary[] };
// query matches title or project_cwd, case-insensitive; pinned sorted by ended_at desc; history excludes pinned.

// relativeTime.ts
export function formatRelativeTime(epochMs: number, now?: number): string;
// "just now" (<60s), "5m ago", "3h ago", "2d ago", else "2026-07-06"
```

- [ ] **Step 1: Write failing tests** for `visibleSessions` (filtering by query/agent, pin split, ordering) and `formatRelativeTime` (each band + boundary). Mock nothing — both are pure.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/sessions`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement bridge, store, relativeTime**

Bridge is thin `invoke`/`listen` wrappers (copy the style of `fsBridge.ts`; `listen` comes from `@tauri-apps/api/event`). Store methods wrap bridge calls in `try/catch` that leaves state unchanged on error.

- [ ] **Step 4: Run until green, plus typecheck**

Run: `pnpm test src/modules/sessions && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/modules/sessions
git commit -m "feat(sessions): frontend bridge, store, and relative-time helper"
```

---

### Task 10: Sidebar registration + list UI

**Files:**
- Modify: `src/stores/uiStore.ts:3` (add `"sessions"` to `SidebarView`)
- Modify: `src/components/Sidebar.tsx` (import + `SIDEBAR_TABS` entry + conditional render)
- Modify: `src/i18n/locales/en/common.json`, `src/i18n/locales/zh-Hant/common.json`
- Create: `src/modules/sessions/SessionsPanel.tsx`

**Interfaces:**
- Consumes: `useSessionsStore`, `visibleSessions`, `formatRelativeTime`, `openSessionsTab` (Task 12 — until then clicking a row only calls `select(id)`; wire the tab-open in Task 12).

- [ ] **Step 1: Register the view**

`uiStore.ts:3`:
```ts
export type SidebarView = "workspaces" | "explorer" | "sourceControl" | "ai" | "notes" | "connections" | "sessions";
```

`Sidebar.tsx` — add to imports `History` from lucide-react and the panel; append to `SIDEBAR_TABS`:
```ts
{ id: "sessions", icon: History, labelKey: "nav.sessions" },
```
and to the body:
```tsx
{sidebarView === "sessions" && <SessionsPanel />}
```

i18n `nav` blocks — en: `"sessions": "AI Sessions"`; zh-Hant: `"sessions": "AI 對話"`.

- [ ] **Step 2: Add the remaining i18n keys** (both locales, new top-level `"sessions"` object):

```json
// en
"sessions": {
  "live": "Live",
  "pinned": "Pinned",
  "searchPlaceholder": "Search sessions…",
  "all": "All",
  "empty": "No sessions found",
  "messages": "{{count}} msgs",
  "resume": "Resume",
  "pin": "Pin",
  "unpin": "Unpin",
  "selectPrompt": "Select a session from the sidebar",
  "resumeUnavailable": "Resume is not available for this agent",
  "indexing": "Indexing sessions…"
}
// zh-Hant
"sessions": {
  "live": "進行中",
  "pinned": "已釘選",
  "searchPlaceholder": "搜尋對話…",
  "all": "全部",
  "empty": "沒有符合的對話",
  "messages": "{{count}} 則訊息",
  "resume": "接續對話",
  "pin": "釘選",
  "unpin": "取消釘選",
  "selectPrompt": "從側邊欄選一場對話",
  "resumeUnavailable": "這個 agent 不支援接續",
  "indexing": "正在建立索引…"
}
```

- [ ] **Step 3: Implement SessionsPanel.tsx**

Structure (Tailwind semantic tokens, list styling patterned on `NotesSidebar`/`ConnectionsPanel`):

```tsx
export function SessionsPanel() {
  // on mount: useSessionsStore.getState().start(); subscribe onSessionsUpdated → refresh (cleanup unlisten)
  // <LiveSection /> placeholder comment until Task 11
  // search input (value=query onChange=setQuery)
  // agent chips: all / claude / codex / antigravity (aria-pressed styling like Sidebar tabs)
  // visibleSessions(...) → Pinned group then history list
  // row: title (truncate), badge = agent label colored per agent
  //      (claude: text-accent, codex: text-fg-subtle, antigravity: text-warning — reuse
  //      whatever warning/info token exists in src/index.css; check before inventing),
  //      basename(project_cwd) · formatRelativeTime(ended_at) · t("sessions.messages", {count})
  // row onClick: select(id) + openSessionsTab() (import added in Task 12; until then select only)
  // pin toggle button on row hover (Pin/PinOff icons)
  // empty state: t("sessions.empty"); loading state: t("sessions.indexing") until loaded
}
```

IME note: the search input filters as-you-type only (no Enter-to-submit handler), so no `isComposing` guard is needed. Do not add an Enter handler.

- [ ] **Step 4: Verify manually**

Run: `pnpm tauri dev` → open the sidebar's new History icon (⌥7 range extends automatically). Expect: list populates after initial indexing; search and agent chips filter; pin toggles persist across app restart.

- [ ] **Step 5: Typecheck + tests still green**

Run: `pnpm typecheck && pnpm test src/modules/sessions`

- [ ] **Step 6: Commit**

```bash
git add src/stores/uiStore.ts src/components/Sidebar.tsx src/i18n src/modules/sessions
git commit -m "feat(sessions): sidebar sessions panel with search, filters, and pins"
```

---

### Task 11: Live section

**Files:**
- Create: `src/modules/sessions/lib/liveSessions.ts`, `src/modules/sessions/lib/liveSessions.test.ts`
- Modify: `src/modules/sessions/SessionsPanel.tsx`

**Interfaces:**
- Consumes: `useSessionStatusStore` (`statuses`, `agents` — `Record<leafId, …>`), `useTabsStore` (`tabs`, `setActive`, `setActiveLeaf`), `computeLayout`/`findPaneContent` from `terminalLayout`.
- Produces:

```ts
export interface LiveSession {
  tabId: string; leafId: string; tabTitle: string;
  agent: string;             // from sessionStatusStore.agents
  status: string;            // from sessionStatusStore.statuses
  cwd: string | null;        // pane cwd ?? tab.cwd ?? null
}
// Pure: derive from plain snapshots so it's trivially testable.
export function deriveLiveSessions(
  tabs: Tab[],
  statuses: Record<string, string>,
  agents: Record<string, string>,
): LiveSession[];
```

- [ ] **Step 1: Write failing tests** — fabricate two tabs (one with a terminal pane whose leafId has a status, one without), assert only the live one is returned with the right tab/leaf ids and cwd fallback order.

- [ ] **Step 2: Implement** `deriveLiveSessions` (walk `computeLayout(tab.paneTree)`, keep panes whose id is in `statuses`), then the `LiveSection` component inside SessionsPanel: subscribe to the three stores, render status dot + agent + tab title, `onClick: setActive(tabId); setActiveLeaf(tabId, leafId)`. Hide the section when empty.

- [ ] **Step 3: Run until green**

Run: `pnpm test src/modules/sessions && pnpm typecheck`

- [ ] **Step 4: Manual check** — run `claude` in a terminal tab, confirm the Live entry appears (status hooks must be enabled in settings) and clicking it focuses the pane.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sessions
git commit -m "feat(sessions): live section jumping to the running terminal pane"
```

---

### Task 12: Sessions content tab + transcript viewer

**Files:**
- Modify: `src/modules/terminal/lib/terminalLayout.ts:15` (PaneContent union: add `| { kind: "sessions" }`)
- Modify: `src/stores/tabsStore.ts` (TabKind union + `openSessionsTab`)
- Modify: `src/modules/terminal/PaneTabContent.tsx` (lazy import + render branch before the terminal fallback)
- Modify: `src/components/TabBar.tsx:62` area (icon case: `History`)
- Modify: `src/i18n/locales/{en,zh-Hant}/common.json` (`tabs`: `"sessions": "AI Sessions"` / `"AI 對話"`)
- Create: `src/modules/sessions/SessionsTabContent.tsx`
- Modify: `src/modules/sessions/SessionsPanel.tsx` (row click → `select(id)` + `openSessionsTab()`)

**Interfaces:**
- Produces: `openSessionsTab(): string` in tabsStore — copy `openGitGraphTab` verbatim with `kind: "sessions"`, content `{ kind: "sessions" }`, title `"AI Sessions"` (singleton per space).
- `SessionsTabContent` reads `selectedId` from `useSessionsStore`; `null` ⇒ empty state (`sessions.selectPrompt` + total count); else fetch `sessionsGet(selectedId)` in an effect (cancel stale responses by comparing ids) and render the transcript.

- [ ] **Step 1: tabsStore test first** — `src/stores/tabsStore.test.ts` already exists; add a test that `openSessionsTab` creates a singleton (second call focuses the first) mirroring the existing git-graph test if present, else a minimal new one.

- [ ] **Step 2: Run to verify failure, implement store change, run until green**

Run: `pnpm test src/stores`

- [ ] **Step 3: Wire PaneContent / PaneTabContent / TabBar / i18n**

PaneTabContent: add beside the git-graph lazy import and branch:
```tsx
const SessionsTabContent = lazy(() =>
  import("@/modules/sessions/SessionsTabContent").then((m) => ({ default: m.SessionsTabContent })),
);
// …
) : pane.content.kind === "sessions" ? (
  <SessionsTabContent />
```
TabBar icon `case "sessions": return History;`.

- [ ] **Step 4: Implement SessionsTabContent.tsx**

```tsx
// Header: back-less (empty state doubles as home in P1), session title,
// agent badge, project path, action buttons: Resume (Task 13), Pin toggle.
// Body: message list — role label + bubble-less blocks:
//   user: left border accent, assistant: plain, tool: collapsed <details>
//   with tool_name as <summary>, system: muted italic.
// Timestamps via formatRelativeTime. Long transcripts: plain scroll (no
// virtualization in P1 — re-parse already capped by on-demand fetch).
// Loading and error states (error: keep previous transcript, show a muted line).
```

- [ ] **Step 5: Manual verify** — click sessions in the sidebar: tab opens/reuses, transcript renders for all three agents (pick one real session each), empty state shows when nothing selected.

- [ ] **Step 6: Typecheck + full frontend tests**

Run: `pnpm typecheck && pnpm test`

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat(sessions): sessions content tab with transcript viewer"
```

---

### Task 13: Resume + final verification

**Files:**
- Create: `src/modules/sessions/lib/resume.ts`, `src/modules/sessions/lib/resume.test.ts`
- Modify: `src/modules/sessions/SessionsTabContent.tsx` (Resume button), `src/modules/sessions/SessionsPanel.tsx` (row context/hover Resume button)

**Interfaces:**
- Consumes: `useTabsStore.getState().newTerminalTab(cwd)`, `writeToTerminal(leafId, text)` from `terminalBus`.
- Produces:

```ts
// Pure command builder — unit-tested; null means resume unsupported (button hidden).
export function resumeCommand(agent: SessionAgent, sessionId: string): string | null;
// claude → `claude --resume ${sessionId}`
// codex  → `codex resume ${sessionId}`
// antigravity → null (CLI resume unverified; hide the button)
export function resumeSession(s: SessionSummary): boolean;
// resumeCommand null → false. Else newTerminalTab(s.project_cwd || undefined),
// read back the created tab's activeLeafId from the store (pattern in
// terminalBus.runCommandInTerminal), writeToTerminal(leafId, cmd + "\n"), true.
```

- [ ] **Step 1: Verify the codex CLI syntax** (grounding, 1 min)

Run: `codex resume --help 2>&1 | head -20`
Expected: usage text confirming `codex resume <SESSION_ID>`. If it differs, adjust `resumeCommand` and its test to the real syntax; note the verified syntax in a code comment. Session ids must be shell-quoted only if they can contain non-alphanumerics — all three id formats are UUID-like, so interpolation is safe; assert that in the test (id matches `/^[A-Za-z0-9-]+$/` guard in `resumeCommand`, returning null otherwise).

- [ ] **Step 2: Write failing tests for `resumeCommand`** (three agents + malicious id rejected), run, implement, green.

Run: `pnpm test src/modules/sessions`

- [ ] **Step 3: Wire buttons** — Resume in the viewer header and on row hover; hidden when `resumeCommand(...) === null`; tooltip `sessions.resumeUnavailable` shown for antigravity via a disabled state instead of hiding, pick one and keep it consistent: **hide on rows, disabled-with-tooltip in the viewer header**.

- [ ] **Step 4: Manual verify** — resume a real Claude session and a real Codex session: new terminal tab opens at the project cwd and the CLI resumes the right conversation.

- [ ] **Step 5: Full verification sweep**

```bash
cd src-tauri && cargo test && cargo check
cd .. && pnpm typecheck && pnpm test && pnpm build
```
Expected: everything green.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat(sessions): one-click resume into a new terminal tab"
```

---

### Task 14: PR

- [ ] **Step 1:** Re-read the spec's P1 row; confirm every bullet is shipped (parsers ×3, index, watcher, sidebar list with Live/search/filter/pins, viewer, resume).
- [ ] **Step 2:** Push and open the PR per project rules:

```bash
git push -u origin feat/ai-sessions-view
MILESTONE=$(gh api repos/mukiwu/tempo-term/milestones --jq '.[0].title')
gh pr create --title "feat: AI sessions view (P1) — cross-agent session browser" --body "<summary + test plan>"
gh pr edit <n> --add-label enhancement --milestone "$MILESTONE" --add-assignee mukiwu
```
- [ ] **Step 3:** Wait for `gemini-code-assist[bot]` review and triage per project rules.
