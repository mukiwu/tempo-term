//! Per-session terminal logging. Every local PTY and SSH session can tee its
//! raw output (ANSI included) into its own timestamped `.log` file under the
//! app data dir, browsable later in the Logs panel. Writing runs on a dedicated
//! std thread fed by a bounded channel; the tee uses `try_send` so a slow disk
//! can never stall or break the terminal — a full channel just drops the chunk.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{AppHandle, Manager};

const DIR_NAME: &str = "session-logs";
/// Bounded so a stuck writer can't grow memory without limit. On overflow the
/// tee drops the chunk (best-effort logging), never blocking the terminal.
const CHANNEL_CAPACITY: usize = 256;

/// Monotonically increasing counter appended to each log filename so that two
/// sessions starting within the same wall-clock second (e.g. several `zsh`
/// tabs restoring simultaneously) get distinct paths and never collide.
static LOG_SEQ: AtomicU64 = AtomicU64::new(0);

pub struct LoggerHandle {
    pub tx: SyncSender<Vec<u8>>,
}

/// Map a session label (shell name or user@host) to a filename-safe form: keep
/// alphanumerics and `-_.`; everything else becomes `_`.
fn sanitize(label: &str) -> String {
    label
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
            _ => '_',
        })
        .collect()
}

/// `<YYYYMMDD_HHMMSS>_<label>.log`
fn log_filename(stamp: &str, label: &str) -> String {
    format!("{}_{}.log", stamp, sanitize(label))
}

/// A bare `.log` filename (no separators, no `..`) — the only thing
/// `session_log_read` accepts, so a crafted name can't escape the logs dir.
fn is_safe_log_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && name.ends_with(".log")
}

/// Names whose mtime is strictly older than `now_ms - retention_days`.
/// Pure so it can be unit-tested without touching the filesystem.
fn select_expired(entries: &[(String, i64)], now_ms: i64, retention_days: i64) -> Vec<String> {
    let cutoff = now_ms - retention_days * 86_400_000;
    entries
        .iter()
        .filter(|(_, mtime)| *mtime < cutoff)
        .map(|(name, _)| name.clone())
        .collect()
}

/// Create the logs directory with owner-only permissions (0o700) on Unix.
/// Falls back to plain `create_dir_all` on other platforms.
#[cfg(unix)]
fn ensure_logs_dir(dir: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
        .map_err(|e| format!("create log dir: {e}"))
}
#[cfg(not(unix))]
fn ensure_logs_dir(dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("create log dir: {e}"))
}

pub fn logs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(DIR_NAME))
}

/// Start a per-session logger writing into `dir`. Feed each raw output chunk to
/// the returned `tx`; dropping every sender closes the file (writes the footer).
/// Split from `start_logger` so it is testable against a temp dir.
fn start_logger_in(dir: PathBuf, label: &str) -> Result<LoggerHandle, String> {
    ensure_logs_dir(&dir)?;
    // Append a process-global sequence number so same-second sessions (e.g. two
    // `zsh` tabs restoring at once) produce distinct filenames and never collide.
    let seq = LOG_SEQ.fetch_add(1, Ordering::Relaxed);
    let stamp = format!("{}_{}", chrono::Local::now().format("%Y%m%d_%H%M%S"), seq);
    let path = dir.join(log_filename(&stamp, label));
    let (tx, rx) = sync_channel::<Vec<u8>>(CHANNEL_CAPACITY);
    let path_clone = path.clone();

    std::thread::spawn(move || {
        let mut opts = OpenOptions::new();
        opts.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = match opts.open(&path_clone) {
            Ok(f) => f,
            Err(_) => return,
        };
        let header = format!(
            "\n===== Session started at {} =====\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
        );
        let _ = file.write_all(header.as_bytes());
        while let Ok(bytes) = rx.recv() {
            if file.write_all(&bytes).is_err() {
                break;
            }
        }
        let footer = format!(
            "\n===== Session ended at {} =====\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
        );
        let _ = file.write_all(footer.as_bytes());
        let _ = file.flush();
    });

    Ok(LoggerHandle { tx })
}

/// Start a logger under the app's `session-logs` dir, labelled by shell name or
/// `user@host`.
pub fn start_logger(app: &AppHandle, label: &str) -> Result<LoggerHandle, String> {
    start_logger_in(logs_dir(app)?, label)
}

#[derive(Debug, Serialize)]
pub struct LogEntry {
    pub name: String,
    pub size: u64,
    pub modified_unix_ms: i64,
}

/// List every `.log` in the logs dir, newest first.
#[tauri::command]
pub fn session_logs_list(app: AppHandle) -> Result<Vec<LogEntry>, String> {
    let dir = logs_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("log") {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) if m.is_file() => m,
            _ => continue,
        };
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let modified_unix_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        entries.push(LogEntry { name, size: meta.len(), modified_unix_ms });
    }
    entries.sort_by(|a, b| b.modified_unix_ms.cmp(&a.modified_unix_ms));
    Ok(entries)
}

/// Read one log by bare filename, guarded against path traversal.
/// Returns raw binary via `tauri::ipc::Response` to avoid JSON serialization
/// overhead (a JSON array of numbers is ~3× larger and much slower than raw bytes).
#[tauri::command]
pub fn session_log_read(app: AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    if !is_safe_log_name(&name) {
        return Err("invalid log name".into());
    }
    let dir = logs_dir(&app)?;
    let path = dir.join(&name);
    let canon_dir = fs::canonicalize(&dir).map_err(|e| e.to_string())?;
    let canon_path = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !canon_path.starts_with(&canon_dir) {
        return Err("path escapes logs directory".into());
    }
    let bytes = fs::read(&canon_path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn session_logs_dir_path(app: AppHandle) -> Result<String, String> {
    Ok(logs_dir(&app)?.to_string_lossy().into_owned())
}

/// Open the logs dir in the OS file manager.
#[tauri::command]
pub fn session_logs_open_dir(app: AppHandle) -> Result<(), String> {
    let dir = logs_dir(&app)?;
    ensure_logs_dir(&dir)?;
    let status = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(&dir).status()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("explorer").arg(&dir).status()
    } else {
        std::process::Command::new("xdg-open").arg(&dir).status()
    };
    status.map(|_| ()).map_err(|e| e.to_string())
}

/// Delete logs older than `retention_days`. `None` means keep forever (no-op).
#[tauri::command]
pub fn session_logs_enforce_retention(app: AppHandle, retention_days: Option<i64>) -> Result<(), String> {
    let Some(days) = retention_days else { return Ok(()) };
    // A zero or negative value would make the cutoff >= now and delete ALL logs.
    // Guard here at the command boundary; `select_expired` itself is pure and
    // assumes a valid positive day count.
    if days <= 0 {
        return Err("retention days must be greater than zero".into());
    }
    let dir = logs_dir(&app)?;
    if !dir.exists() {
        return Ok(());
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let entries: Vec<(String, i64)> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension().and_then(|s| s.to_str()) != Some("log") {
                return None;
            }
            let name = path.file_name()?.to_str()?.to_string();
            let mtime = e
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as i64;
            Some((name, mtime))
        })
        .collect();
    for name in select_expired(&entries, now_ms, days) {
        let _ = fs::remove_file(dir.join(name));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_keeps_safe_chars_and_replaces_others() {
        assert_eq!(sanitize("zsh"), "zsh");
        assert_eq!(sanitize("powershell.exe"), "powershell.exe");
        assert_eq!(sanitize("rd2@10.0.217.54"), "rd2_10.0.217.54");
        assert_eq!(sanitize("a b/c\\d"), "a_b_c_d");
    }

    #[test]
    fn log_filename_is_stamp_underscore_label_dot_log() {
        assert_eq!(log_filename("20260507_143343", "rd2@10.0.217.54"), "20260507_143343_rd2_10.0.217.54.log");
    }

    #[test]
    fn is_safe_log_name_rejects_traversal_and_non_log() {
        assert!(is_safe_log_name("20260507_143343_zsh.log"));
        assert!(!is_safe_log_name("../secret.log"));
        assert!(!is_safe_log_name("a/b.log"));
        assert!(!is_safe_log_name("a\\b.log"));
        assert!(!is_safe_log_name("notes.txt"));
        assert!(!is_safe_log_name(""));
    }

    #[test]
    fn select_expired_returns_names_older_than_cutoff() {
        // now = 100 days in ms; retention 30 days. Anything with mtime older
        // than now - 30d is expired.
        let day = 86_400_000_i64;
        let now = 100 * day;
        let entries = vec![
            ("old.log".to_string(), now - 40 * day),
            ("fresh.log".to_string(), now - 10 * day),
            ("edge.log".to_string(), now - 30 * day), // exactly at cutoff: keep
        ];
        let expired = select_expired(&entries, now, 30);
        assert_eq!(expired, vec!["old.log".to_string()]);
    }

    #[test]
    fn select_expired_with_valid_positive_days_uses_correct_cutoff_math() {
        // Verify cutoff = now_ms - days * 86_400_000.
        // With retention_days=7, anything strictly older than 7 days ago is expired.
        let day = 86_400_000_i64;
        let now = 1_000 * day;
        let entries = vec![
            ("week_old.log".to_string(), now - 7 * day),     // exactly at cutoff: keep
            ("eight_days.log".to_string(), now - 8 * day),   // 1 ms past cutoff: expire
            ("six_days.log".to_string(), now - 6 * day),     // fresh: keep
        ];
        let expired = select_expired(&entries, now, 7);
        assert_eq!(expired, vec!["eight_days.log".to_string()]);
    }

    // Note: the `days <= 0` guard lives at the `session_logs_enforce_retention` command
    // boundary (needs an AppHandle, so not unit-testable here). `select_expired` itself
    // is a pure function that assumes a positive day count; the guard above prevents it
    // from ever being called with non-positive values from the public command surface.

    #[cfg(unix)]
    #[test]
    fn log_file_and_dir_are_owner_only_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir()
            .join(format!("ttlog-perms-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&dir);
        let handle = start_logger_in(dir.clone(), "zsh").unwrap();
        handle.tx.send(b"secret token\n".to_vec()).unwrap();
        drop(handle);

        // Poll for the log file to appear and the writer to finish.
        let mut log_path = None;
        for _ in 0..50 {
            if let Some(entry) = std::fs::read_dir(&dir).ok().and_then(|mut r| r.next()).and_then(|e| e.ok()) {
                let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
                if content.contains("Session ended at") {
                    log_path = Some(entry.path());
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        let log_path = log_path.expect("log file not found");
        let file_mode = std::fs::metadata(&log_path).unwrap().permissions().mode() & 0o777;
        let dir_mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;

        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(file_mode, 0o600, "log file should be owner-only (0o600), got {file_mode:#o}");
        assert_eq!(dir_mode, 0o700, "logs dir should be owner-only (0o700), got {dir_mode:#o}");
    }

    #[test]
    fn logger_writes_header_payload_and_footer() {
        let dir = std::env::temp_dir().join(format!("ttlog-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&dir);
        let handle = start_logger_in(dir.clone(), "zsh").unwrap();
        handle.tx.send(b"hello world\n".to_vec()).unwrap();
        drop(handle); // closes the channel -> writer flushes footer and exits

        // Poll briefly for the writer thread to finish (it has no JoinHandle).
        let mut content = String::new();
        for _ in 0..50 {
            if let Some(entry) = std::fs::read_dir(&dir).ok().and_then(|mut r| r.next()).and_then(|e| e.ok()) {
                content = std::fs::read_to_string(entry.path()).unwrap_or_default();
                if content.contains("Session ended at") {
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(content.contains("Session started at"), "header missing: {content:?}");
        assert!(content.contains("hello world"), "payload missing: {content:?}");
        assert!(content.contains("Session ended at"), "footer missing: {content:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
