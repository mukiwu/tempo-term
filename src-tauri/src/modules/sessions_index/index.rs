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

    /// This project's sessions, newest first, capped at 50. Same row shape as
    /// `list()`, filtered to one `project_cwd`.
    pub fn list_for_project(&self, project_cwd: &str) -> Vec<SessionSummary> {
        let mut stmt = match self.conn.prepare(
            "SELECT s.id,s.agent,s.project_cwd,s.title,s.started_at,s.ended_at,
                    s.message_count,s.user_message_count,s.output_tokens,s.model,s.file_path,
                    (p.session_id IS NOT NULL) AS pinned
             FROM sessions s LEFT JOIN pins p ON p.session_id = s.id
             WHERE s.project_cwd = ?1 ORDER BY s.ended_at DESC LIMIT 50",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map(params![project_cwd], |r| {
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

    /// A single session's full summary by id, or `None` if unknown. Used by
    /// `sessions_export`, which needs the header metadata (title, agent,
    /// project, date range) alongside the transcript — a targeted SELECT
    /// instead of filtering the full `list()` result set.
    pub fn lookup_summary(&self, id: &str) -> Option<SessionSummary> {
        self.conn
            .query_row(
                "SELECT s.id,s.agent,s.project_cwd,s.title,s.started_at,s.ended_at,
                        s.message_count,s.user_message_count,s.output_tokens,s.model,s.file_path,
                        (p.session_id IS NOT NULL) AS pinned
                 FROM sessions s LEFT JOIN pins p ON p.session_id = s.id
                 WHERE s.id=?1",
                params![id],
                |r| {
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
                },
            )
            .ok()
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

    /// Remove one session's rows (sessions, activity, and any pin) from the
    /// index, atomically — either all three tables lose their rows or none
    /// do, so a failure mid-way can't leave orphaned activity or a stale pin.
    /// Idempotent — deleting an unknown id is not an error, since a
    /// concurrent full sync could have already pruned it. Does not touch the
    /// source file on disk; that's the caller's job (trashing it) before or
    /// after this call.
    ///
    /// `unchecked_transaction` because this method takes `&self` (matching
    /// every other method on `Index`, whose callers share it behind a
    /// `Mutex`); the mutex already guarantees the exclusive access that
    /// `transaction()`'s `&mut self` would otherwise enforce at compile time.
    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM activity WHERE session_id=?1", params![id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM pins WHERE session_id=?1", params![id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM sessions WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
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
    fn lookup_summary_returns_the_full_summary_for_a_known_id() {
        let index = Index::open(&temp_db("lookup-summary")).unwrap();
        index.upsert_session(&sample("s1"), "/f/s1.jsonl", 1, 1).unwrap();
        index.set_pinned("s1", true).unwrap();

        let summary = index.lookup_summary("s1").unwrap();

        assert_eq!(summary.id, "s1");
        assert_eq!(summary.agent, "claude");
        assert_eq!(summary.project_cwd, "/tmp/proj");
        assert_eq!(summary.title, "hello");
        assert_eq!(summary.started_at, 1000);
        assert_eq!(summary.ended_at, 2000);
        assert_eq!(summary.message_count, 4);
        assert_eq!(summary.user_message_count, 2);
        assert_eq!(summary.output_tokens, Some(50));
        assert_eq!(summary.model, Some("claude-sonnet-5".to_string()));
        assert_eq!(summary.file_path, "/f/s1.jsonl");
        assert!(summary.pinned);
    }

    #[test]
    fn lookup_summary_returns_none_for_an_unknown_id() {
        let index = Index::open(&temp_db("lookup-summary-unknown")).unwrap();
        assert!(index.lookup_summary("nope").is_none());
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
    fn delete_session_removes_sessions_activity_and_pin_rows() {
        let index = Index::open(&temp_db("delete")).unwrap();
        index.upsert_session(&sample("s1"), "/f/s1.jsonl", 1, 1).unwrap();
        index.set_pinned("s1", true).unwrap();

        index.delete_session("s1").unwrap();

        assert!(index.list().is_empty());
        assert_eq!(index.lookup_file("s1"), None);
        // The pins row is gone too, not just orphaned — re-inserting the same
        // id later must not resurrect a stale pin.
        let count: i64 = index
            .conn
            .query_row("SELECT COUNT(*) FROM pins WHERE session_id='s1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn delete_session_leaves_other_sessions_untouched() {
        let index = Index::open(&temp_db("delete-other")).unwrap();
        index.upsert_session(&sample("s1"), "/f/a.jsonl", 1, 1).unwrap();
        index.upsert_session(&sample("s2"), "/f/b.jsonl", 1, 1).unwrap();
        index.set_pinned("s2", true).unwrap();

        index.delete_session("s1").unwrap();

        let rows = index.list();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "s2");
        assert!(rows[0].pinned);
    }

    #[test]
    fn delete_session_is_idempotent_for_an_unknown_id() {
        let index = Index::open(&temp_db("delete-unknown")).unwrap();
        assert!(index.delete_session("nope").is_ok());
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
