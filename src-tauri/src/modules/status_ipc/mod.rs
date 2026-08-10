//! Session-status delivery over a loopback socket. Claude Code / Codex hooks
//! run a native shim — this very binary invoked as `tempo-term --status-hook
//! <agent> <state>` — that reports the pane's live state to a small TCP listener
//! the app runs on `127.0.0.1`. Originally built for Windows (#155), where hooks
//! run through cmd, which can't execute a bare `.sh`; now the one delivery
//! path on every platform (#181), replacing the injected script + `/dev/$tty`
//! OSC + process-ancestry walk that macOS used to need. The frontend keeps an
//! OSC 6973 handler for SSH remote panes, which still deliver in-band over
//! the pty stream.
//!
//! Correlation: each pane's shell is spawned with `TEMPOTERM_PANE_ID` (the pty
//! session id) and `TEMPOTERM_STATUS_ADDR` in its environment — the same channel
//! that already carries `TEMPOTERM=1`. The hook subprocess inherits them, so the
//! backend knows exactly which pane a status belongs to without walking process
//! ancestry. `TEMPOTERM_STATUS_TOKEN` is a per-run secret the shim echoes back so
//! another local process can't spoof a pane's badge over the open loopback port.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::time::Duration;

use serde::Serialize;

/// How long the shim waits to connect (and to write) before giving up. A status
/// ping must never stall the hook that sent it (see module docs), so both the
/// connect and the write below are bounded to this.
const SEND_TIMEOUT: Duration = Duration::from_millis(200);

/// Environment variable names shared by the app (which sets them per pane) and
/// the shim (which reads them). Public so `pty::session` and the shim agree.
pub const ENV_ADDR: &str = "TEMPOTERM_STATUS_ADDR";
pub const ENV_TOKEN: &str = "TEMPOTERM_STATUS_TOKEN";
pub const ENV_PANE_ID: &str = "TEMPOTERM_PANE_ID";
pub const ENV_MARKER: &str = "TEMPOTERM";
/// Where the shim appends one line per hook event. Carried in the pane's env
/// like the address above, for two reasons: the shim runs before Tauri starts
/// (see `run`), so it has no `AppHandle` to resolve an app-data path with, and
/// keeping it in the injected env means a Codex or Claude session started
/// outside a tempo-term pane writes nothing at all.
pub const ENV_LOG: &str = "TEMPOTERM_STATUS_LOG";

/// Log file name under the app data directory.
const HOOK_LOG_FILE: &str = "status-hook.log";

/// Rewrite the log from empty once it passes this. The shim runs on every hook
/// event of every session, so an uncapped file would grow without bound; a few
/// thousand lines is far more than any diagnosis needs.
const HOOK_LOG_MAX_BYTES: u64 = 256 * 1024;

/// The Tauri event the listener emits; the frontend routes it to the pane whose
/// pty id matches `pane_id` (see TerminalView).
pub const STATUS_EVENT: &str = "session-status";

/// A parsed status message. `kind` is `status` (a direct state like
/// `active`/`idle`) or `notify` (a Claude notification_type the app resolves).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusMessage {
    pub pane_id: u32,
    pub kind: String,
    pub payload: String,
    pub session_id: Option<String>,
    pub agent: Option<String>,
}

/// Wire format sent by the shim, one message per connection:
/// `<token>\t<paneId>\t<kind>\t<payload>\t<sessionId>\t<agent>`. The final two
/// fields are optional for compatibility with older shims. Returns the message
/// only when the token matches and the pane id parses, so a spoofed or malformed
/// line is dropped. Pure so it can be unit-tested without a socket.
pub fn parse_message(line: &str, expected_token: &str) -> Option<StatusMessage> {
    let mut parts = line.trim_end_matches(['\n', '\r']).splitn(6, '\t');
    let token = parts.next()?;
    // Constant-time-ish token check is overkill for a cosmetic loopback badge;
    // a plain compare rejects spoofers well enough.
    if token != expected_token || expected_token.is_empty() {
        return None;
    }
    let pane_id: u32 = parts.next()?.parse().ok()?;
    let kind = parts.next()?;
    let payload = parts.next().unwrap_or("");
    let session_id = parts
        .next()
        .filter(|session_id| !session_id.is_empty())
        .map(str::to_string);
    let agent = parts
        .next()
        .filter(|agent| matches!(*agent, "claude" | "codex"))
        .map(str::to_string);
    if kind != "status" && kind != "notify" {
        return None;
    }
    if payload.is_empty() {
        return None;
    }
    Some(StatusMessage {
        pane_id,
        kind: kind.to_string(),
        payload: payload.to_string(),
        session_id,
        agent,
    })
}

/// Build the wire line the shim sends. Kept next to `parse_message` so the two
/// stay in sync.
fn encode_message(
    token: &str,
    pane_id: &str,
    kind: &str,
    payload: &str,
    session_id: &str,
    agent: &str,
) -> String {
    format!("{token}\t{pane_id}\t{kind}\t{payload}\t{session_id}\t{agent}")
}

/// Live listener details handed to each pane so its shim can phone home.
pub struct StatusIpc {
    addr: String,
    token: String,
    log_path: String,
}

impl StatusIpc {
    /// The `(name, value)` env pairs to inject into a pane spawned as `pane_id`,
    /// so its status hook can reach us and be trusted. Returns `None` when the
    /// listener never started (then panes simply carry no status env).
    pub fn env_for(&self, pane_id: u32) -> Vec<(String, String)> {
        let mut env = vec![
            (ENV_ADDR.to_string(), self.addr.clone()),
            (ENV_TOKEN.to_string(), self.token.clone()),
            (ENV_PANE_ID.to_string(), pane_id.to_string()),
        ];
        // Omitted when the app-data path could not be resolved: the shim then
        // behaves exactly as it did before, silently.
        if !self.log_path.is_empty() {
            env.push((ENV_LOG.to_string(), self.log_path.clone()));
        }
        env
    }
}

/// Bind a loopback listener on an OS-assigned port and spawn the accept loop.
/// Each accepted connection is one status message; valid ones are emitted to the
/// frontend as [`STATUS_EVENT`]. Returns the [`StatusIpc`] handle to manage, or
/// an error if the port can't be bound (then status tracking is simply off).
///
/// Connections are handled sequentially on the accept-loop thread rather than
/// one thread per connection: any local process can open connections to this
/// loopback port, and an unbounded thread-per-connection loop lets it exhaust
/// the process's threads. A status ping is one short line, and the tight read
/// timeout in `handle_connection` bounds how long a slow or hung client can
/// occupy the loop, so a flood of connections costs bounded time per
/// connection rather than one OS thread each.
pub fn start(app: &tauri::AppHandle) -> Result<StatusIpc, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = generate_token();
    // Resolved before the handle is moved into the accept loop below.
    let log_path = hook_log_path(app);

    let app = app.clone();
    let accept_token = token.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            handle_connection(stream, &accept_token, &app);
        }
    });

    Ok(StatusIpc {
        addr: format!("127.0.0.1:{port}"),
        token,
        log_path,
    })
}

/// The shim's log file inside the app data directory, or an empty string when
/// that path cannot be resolved — logging is diagnostic, so it degrades to off
/// rather than failing the listener that panes actually depend on.
fn hook_log_path(app: &tauri::AppHandle) -> String {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(HOOK_LOG_FILE))
        .ok()
        .and_then(|path| path.to_str().map(str::to_string))
        .unwrap_or_default()
}

fn handle_connection(stream: TcpStream, token: &str, app: &tauri::AppHandle) {
    // Bounded so a slow or hung client can only occupy the (single) accept
    // loop for a short, fixed time — see `start`.
    let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
    let mut buf = String::new();
    // A status line is tiny; cap the read so a misbehaving client can't stream
    // unbounded data into memory.
    if stream.take(4096).read_to_string(&mut buf).is_err() {
        return;
    }
    // The token check (first field parsed in `parse_message`) is the first
    // gate on an accepted connection: an untrusted local process still has to
    // guess the per-run secret before anything it sends is acted on.
    if let Some(msg) = parse_message(&buf, token) {
        use tauri::Emitter;
        let _ = app.emit(STATUS_EVENT, msg);
    }
}

/// 16 random bytes, URL-safe base64. Enough to keep a co-resident local process
/// from guessing the token and spoofing a pane's badge.
fn generate_token() -> String {
    use base64::Engine;
    let mut bytes = [0u8; 16];
    // Fall back to a weak-but-present token if the OS RNG somehow fails, rather
    // than disabling status delivery entirely; the token only guards a cosmetic
    // badge on a loopback-only port.
    if orion::util::secure_rand_bytes(&mut bytes).is_err() {
        return "tempoterm-status".to_string();
    }
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// How long the shim waits for its stdin payload before giving up on it. The
/// hook runner writes the event JSON at spawn and closes the pipe, so a healthy
/// read finishes in microseconds; the deadline only exists so a runner that
/// keeps stdin open (inherited tty, a future runner change) can never hang the
/// hook — the same "never stall the caller" contract the socket side bounds
/// with [`SEND_TIMEOUT`].
const STDIN_TIMEOUT: Duration = Duration::from_millis(200);

/// Read up to `limit` bytes of `reader` into a String on a helper thread,
/// giving up after `deadline`. None on timeout or a read error (non-UTF-8).
/// The thread drains any remainder as a courtesy, but only for as long as the
/// shim process lives — a writer still going when the shim exits gets EPIPE,
/// which hook runners already tolerated (pre-session-id shims never read stdin
/// on most events at all). On timeout the helper thread stays blocked on the
/// read and is leaked; callers in long-lived processes (setup's shell probe)
/// accept that as the cost of never stalling on a pipe held open.
pub(crate) fn read_bounded_with_deadline<R>(reader: R, limit: u64, deadline: Duration) -> Option<String>
where
    R: Read + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = String::new();
        let ok = reader.by_ref().take(limit).read_to_string(&mut buf).is_ok();
        let _ = tx.send(ok.then_some(buf));
        let _ = std::io::copy(&mut reader, &mut std::io::sink());
    });
    rx.recv_timeout(deadline).ok().flatten()
}

/// The status-hook shim: `tempo-term --status-hook <agent> <state>`. Reads the
/// pane env the app injected, then delivers one status message over loopback.
/// Runs before Tauri starts (see `run()`), does nothing outside tempo-term, and
/// is best-effort — a status ping must never fail or slow the hook that spawned it.
///
/// Claude Code and Codex pass every hook event's JSON on stdin. We retain at
/// most 512 KiB in memory (bounded by [`STDIN_TIMEOUT`], remainder drained so a
/// large payload does not receive EPIPE) and forward its `session_id` when present. For the
/// `notification` catch-all state, `notification_type` becomes the payload
/// (kind `notify`), mirroring the Unix script. Every other state forwards
/// directly (kind `status`).
pub fn run_hook_shim(state: &str, agent: Option<&str>) {
    if std::env::var(ENV_MARKER).ok().filter(|v| !v.is_empty()).is_none() {
        return;
    }
    // Resolve the listener address before touching stdin: without one there is
    // nobody to report to, so the payload read would be pure wasted latency.
    let addr = match std::env::var(ENV_ADDR) {
        Ok(a) if !a.is_empty() => a,
        _ => {
            log_hook_event(agent, state, "", "no-listener-address");
            return;
        }
    };

    let stdin_json =
        read_bounded_with_deadline(std::io::stdin(), 512 * 1024, STDIN_TIMEOUT).unwrap_or_default();

    let token = std::env::var(ENV_TOKEN).unwrap_or_default();
    let pane_id = std::env::var(ENV_PANE_ID).unwrap_or_default();

    let event = parse_hook_event(&stdin_json);

    let (kind, payload) = if state == "notification" {
        match &event.notification_type {
            Some(t) => ("notify", t.as_str()),
            None => {
                // Unknown/missing type: emit nothing, like the .sh did.
                log_hook_event(agent, state, &pane_id, "no-notification-type");
                return;
            }
        }
    } else {
        ("status", state)
    };

    let line = encode_message(
        &token,
        &pane_id,
        kind,
        payload,
        event.session_id.as_deref().unwrap_or(""),
        agent.filter(|value| matches!(*value, "claude" | "codex")).unwrap_or(""),
    );
    log_hook_event(agent, state, &pane_id, send_status(&addr, &line));
}

/// One line per hook event, appended to the path the pane's env carries. This
/// exists because the shim is otherwise completely silent: every failure path
/// returns quietly (by design — a status ping must never break the hook that
/// sent it), which left issue #279 unanswerable for weeks. A user reporting a
/// hook problem can now say which of three things happened:
///
/// - the file has no line for the event → the hook runner never executed this
///   binary at all, so the problem is the command string or its shell
/// - a line with `connect-failed` / `write-failed` → the shim ran and the
///   listener side is at fault
/// - a line with `sent` → delivery worked, so anything wrong is downstream
///
/// A missing or empty `TEMPOTERM_STATUS_LOG` disables it entirely, which is
/// what a session started outside a tempo-term pane gets.
fn log_hook_event(agent: Option<&str>, state: &str, pane_id: &str, outcome: &str) {
    let path = match std::env::var(ENV_LOG) {
        Ok(p) if !p.is_empty() => p,
        _ => return,
    };
    let stamp = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f%z").to_string();
    append_capped(
        Path::new(&path),
        &hook_log_line(&stamp, agent, state, pane_id, outcome),
        HOOK_LOG_MAX_BYTES,
    );
}

/// Format one log line. Pure so the shape stays pinned by tests — it is the
/// thing a bug report gets pasted from, so it should not drift silently.
fn hook_log_line(
    stamp: &str,
    agent: Option<&str>,
    state: &str,
    pane_id: &str,
    outcome: &str,
) -> String {
    let blank_as_dash = |value: &str| if value.is_empty() { "-".to_string() } else { value.to_string() };
    format!(
        "{stamp} pane={} agent={} state={} {outcome}",
        blank_as_dash(pane_id),
        agent.map(blank_as_dash).unwrap_or_else(|| "-".to_string()),
        blank_as_dash(state),
    )
}

/// Append `line` to `path`, starting the file over once it passes `limit`.
/// Best-effort throughout: a hook event must not fail because its diagnostic
/// could not be written, so every error here is swallowed. Creates the parent
/// directory because the app data dir may not exist on a first run.
fn append_capped(path: &Path, line: &str, limit: u64) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let over_limit = std::fs::metadata(path).is_ok_and(|meta| meta.len() > limit);
    let mut options = std::fs::OpenOptions::new();
    options.create(true).write(true);
    if over_limit {
        options.truncate(true);
    } else {
        options.append(true);
    }
    if let Ok(mut file) = options.open(path) {
        let _ = writeln!(file, "{line}");
    }
}

/// Connect to `addr` and write `line`, bounded by [`SEND_TIMEOUT`] on both the
/// connect and the write so a dead or firewalled listener can never stall the
/// hook that called us. Any failure (bad address, refused/timed-out connect,
/// write error) is a silent no-op — see module docs. Split out from
/// `run_hook_shim` so the socket logic is unit-testable on its own.
/// Returns which of the steps was reached, for the log line the caller writes.
fn send_status(addr: &str, line: &str) -> &'static str {
    let Ok(socket_addr) = addr.parse::<std::net::SocketAddr>() else {
        return "bad-listener-address";
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&socket_addr, SEND_TIMEOUT) else {
        return "connect-failed";
    };
    let _ = stream.set_write_timeout(Some(SEND_TIMEOUT));
    match stream.write_all(line.as_bytes()) {
        Ok(()) => "sent",
        Err(_) => "write-failed",
    }
}

/// The fields the shim cares about from a hook event's stdin JSON.
struct HookEvent {
    notification_type: Option<String>,
    session_id: Option<String>,
}

/// Extract every interesting field of the hook's stdin JSON in one parse —
/// the shim runs on every hook event, so the payload is deserialized once,
/// not once per field. Tolerant of surrounding fields; a field is None when
/// absent, blank, or not a string, and both are None on malformed or
/// truncated input because the shim is best-effort.
fn parse_hook_event(stdin_json: &str) -> HookEvent {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(stdin_json) else {
        return HookEvent { notification_type: None, session_id: None };
    };
    HookEvent {
        notification_type: string_field(&value, "notification_type"),
        session_id: string_field(&value, "session_id"),
    }
}

/// A non-empty string field of `event`, or None.
fn string_field(event: &serde_json::Value, name: &str) -> Option<String> {
    event
        .get(name)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "secret-token";

    #[test]
    fn parses_a_valid_status_line() {
        let line = encode_message(TOKEN, "7", "status", "active", "", "");
        assert_eq!(
            parse_message(&line, TOKEN),
            Some(StatusMessage {
                pane_id: 7,
                kind: "status".into(),
                payload: "active".into(),
                session_id: None,
                agent: None,
            })
        );
    }

    #[test]
    fn parses_a_notify_line() {
        let line = encode_message(TOKEN, "3", "notify", "permission_prompt", "", "");
        assert_eq!(
            parse_message(&line, TOKEN),
            Some(StatusMessage {
                pane_id: 3,
                kind: "notify".into(),
                payload: "permission_prompt".into(),
                session_id: None,
                agent: None,
            })
        );
    }

    #[test]
    fn parses_a_five_field_line_with_session_id() {
        let message = parse_message("secret-token\t7\tstatus\tactive\tsession-123", TOKEN).unwrap();
        assert_eq!(message.session_id.as_deref(), Some("session-123"));
    }

    #[test]
    fn parses_a_legacy_four_field_line_without_session_id() {
        let message = parse_message("secret-token\t7\tstatus\tactive", TOKEN).unwrap();
        assert_eq!(message.session_id, None);
    }

    #[test]
    fn parses_an_empty_session_id_as_none() {
        let message = parse_message("secret-token\t7\tstatus\tactive\t", TOKEN).unwrap();
        assert_eq!(message.session_id, None);
    }

    #[test]
    fn roundtrips_a_session_id_through_encode_and_parse() {
        let line = encode_message(TOKEN, "7", "status", "active", "session-123", "claude");
        assert_eq!(
            parse_message(&line, TOKEN),
            Some(StatusMessage {
                pane_id: 7,
                kind: "status".into(),
                payload: "active".into(),
                session_id: Some("session-123".into()),
                agent: Some("claude".into()),
            })
        );
    }

    #[test]
    fn rejects_an_unknown_agent_without_dropping_the_status() {
        let message =
            parse_message("secret-token\t7\tstatus\tactive\tsession-123\tother", TOKEN).unwrap();
        assert_eq!(message.session_id.as_deref(), Some("session-123"));
        assert_eq!(message.agent, None);
    }

    #[test]
    fn tolerates_a_trailing_newline() {
        let line = format!("{}\n", encode_message(TOKEN, "1", "status", "idle", "", ""));
        assert!(parse_message(&line, TOKEN).is_some());
    }

    #[test]
    fn rejects_a_wrong_token() {
        let line = encode_message("attacker", "1", "status", "active", "", "");
        assert_eq!(parse_message(&line, TOKEN), None);
    }

    #[test]
    fn rejects_when_expected_token_is_empty() {
        // A blank expected token must never match (would let any sender through).
        let line = encode_message("", "1", "status", "active", "", "");
        assert_eq!(parse_message(&line, ""), None);
    }

    #[test]
    fn rejects_an_unknown_kind() {
        let line = encode_message(TOKEN, "1", "bogus", "active", "", "");
        assert_eq!(parse_message(&line, TOKEN), None);
    }

    #[test]
    fn rejects_a_non_numeric_pane_id() {
        let line = encode_message(TOKEN, "abc", "status", "active", "", "");
        assert_eq!(parse_message(&line, TOKEN), None);
    }

    #[test]
    fn rejects_an_empty_payload() {
        let line = encode_message(TOKEN, "1", "status", "", "", "");
        assert_eq!(parse_message(&line, TOKEN), None);
    }

    #[test]
    fn payload_may_contain_hyphens_but_not_tabs() {
        let line = encode_message(TOKEN, "9", "status", "waiting-approval", "", "");
        assert_eq!(parse_message(&line, TOKEN).unwrap().payload, "waiting-approval");
    }

    #[test]
    fn extracts_notification_type_from_stdin_json() {
        let json = r#"{"session_id":"x","notification_type":"idle_prompt","other":1}"#;
        assert_eq!(parse_hook_event(json).notification_type.as_deref(), Some("idle_prompt"));
    }

    #[test]
    fn notification_type_absent_or_blank_is_none() {
        assert_eq!(parse_hook_event(r#"{"foo":"bar"}"#).notification_type, None);
        assert_eq!(parse_hook_event(r#"{"notification_type":""}"#).notification_type, None);
        assert_eq!(parse_hook_event("not json").notification_type, None);
    }

    #[test]
    fn bounded_read_returns_the_payload_and_truncates_at_the_limit() {
        let payload = std::io::Cursor::new(b"{\"session_id\":\"s\"}".to_vec());
        assert_eq!(
            read_bounded_with_deadline(payload, 512, Duration::from_secs(1)).as_deref(),
            Some("{\"session_id\":\"s\"}")
        );
        let long = std::io::Cursor::new(vec![b'a'; 64]);
        assert_eq!(
            read_bounded_with_deadline(long, 8, Duration::from_secs(1)).as_deref(),
            Some("aaaaaaaa")
        );
    }

    #[test]
    fn bounded_read_gives_up_when_the_reader_never_finishes() {
        // A hook runner that keeps stdin open (inherited tty) must not hang the
        // shim: the deadline path returns None well before the reader is done.
        struct NeverDone;
        impl Read for NeverDone {
            fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
                std::thread::sleep(Duration::from_secs(5));
                Ok(0)
            }
        }
        let start = std::time::Instant::now();
        let result = read_bounded_with_deadline(NeverDone, 512, Duration::from_millis(50));
        assert_eq!(result, None);
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "deadline must bound the wait, not the reader"
        );
    }

    #[test]
    fn extracts_session_id_from_stdin_json() {
        let json = r#"{"session_id":"session-123","other":1}"#;
        assert_eq!(parse_hook_event(json).session_id.as_deref(), Some("session-123"));
    }

    #[test]
    fn session_id_absent_blank_or_invalid_json_is_none() {
        assert_eq!(parse_hook_event(r#"{"foo":"bar"}"#).session_id, None);
        assert_eq!(parse_hook_event(r#"{"session_id":""}"#).session_id, None);
        assert_eq!(parse_hook_event("not json").session_id, None);
    }

    #[test]
    fn one_parse_yields_both_fields() {
        let json = r#"{"session_id":"s1","notification_type":"idle_prompt"}"#;
        let event = parse_hook_event(json);
        assert_eq!(event.notification_type.as_deref(), Some("idle_prompt"));
        assert_eq!(event.session_id.as_deref(), Some("s1"));
    }

    #[test]
    fn non_string_fields_are_none_without_poisoning_the_event() {
        let event = parse_hook_event(r#"{"session_id":7,"notification_type":"idle_prompt"}"#);
        assert_eq!(event.session_id, None);
        assert_eq!(event.notification_type.as_deref(), Some("idle_prompt"));
    }

    #[test]
    fn env_for_carries_addr_token_and_pane_id() {
        let ipc = StatusIpc {
            addr: "127.0.0.1:5000".into(),
            token: "tok".into(),
            log_path: "/tmp/status-hook.log".into(),
        };
        let env = ipc.env_for(42);
        assert!(env.contains(&(ENV_ADDR.to_string(), "127.0.0.1:5000".to_string())));
        assert!(env.contains(&(ENV_TOKEN.to_string(), "tok".to_string())));
        assert!(env.contains(&(ENV_PANE_ID.to_string(), "42".to_string())));
        assert!(env.contains(&(ENV_LOG.to_string(), "/tmp/status-hook.log".to_string())));
    }

    #[test]
    fn env_for_omits_the_log_path_when_it_could_not_be_resolved() {
        // app_data_dir() failing must not cost a pane its status env — the
        // listener is what panes depend on, the log is only diagnostic.
        let ipc = StatusIpc {
            addr: "127.0.0.1:5000".into(),
            token: "tok".into(),
            log_path: String::new(),
        };
        let env = ipc.env_for(42);
        assert!(env.iter().all(|(name, _)| name != ENV_LOG));
        assert_eq!(env.len(), 3);
    }

    #[test]
    fn generated_tokens_are_nonempty_and_vary() {
        let a = generate_token();
        let b = generate_token();
        assert!(!a.is_empty());
        assert_ne!(a, b, "two tokens should not collide");
    }

    #[test]
    fn send_status_to_an_unused_port_returns_quickly() {
        // Bind an ephemeral listener just to learn a currently-unused port, then
        // drop it immediately so nothing is listening. A blocking connect with
        // no timeout can stall for many seconds against a dead/firewalled
        // listener; connect_timeout must bound the wait so a status ping can
        // never stall the hook that sent it.
        let addr = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap()
        };
        let start = std::time::Instant::now();
        let outcome = send_status(&addr.to_string(), "token\t1\tstatus\tactive");
        assert!(
            start.elapsed() < std::time::Duration::from_secs(2),
            "send_status must not block waiting on a dead listener"
        );
        assert_eq!(outcome, "connect-failed");
    }

    #[test]
    fn send_status_ignores_an_unparseable_address() {
        // Not a valid SocketAddr; must return immediately rather than panic or
        // attempt a connect.
        let start = std::time::Instant::now();
        let outcome = send_status("not-an-address", "token\t1\tstatus\tactive");
        assert!(start.elapsed() < std::time::Duration::from_millis(50));
        assert_eq!(outcome, "bad-listener-address");
    }

    #[test]
    fn log_line_carries_every_field_a_report_needs() {
        assert_eq!(
            hook_log_line("2026-08-10T11:22:33.444+0800", Some("codex"), "active", "7", "sent"),
            "2026-08-10T11:22:33.444+0800 pane=7 agent=codex state=active sent"
        );
    }

    #[test]
    fn log_line_marks_missing_fields_rather_than_leaving_gaps() {
        // An older hook entry carries no agent, and the no-listener-address
        // case is logged before the pane id is read. Both must still produce a
        // line whose columns line up, or the log stops being greppable.
        assert_eq!(
            hook_log_line("t", None, "idle", "", "no-listener-address"),
            "t pane=- agent=- state=idle no-listener-address"
        );
    }

    fn log_test_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir()
            .join(format!("tempoterm-hooklog-{}-{name}", std::process::id()))
            .join("status-hook.log")
    }

    #[test]
    fn appends_successive_events_and_creates_the_directory() {
        let path = log_test_path("append");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());

        // The app data dir may not exist yet on a first run, so the first write
        // has to create it rather than silently do nothing.
        append_capped(&path, "first", 1024);
        append_capped(&path, "second", 1024);

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first\nsecond\n");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn starts_the_log_over_once_it_outgrows_the_cap() {
        let path = log_test_path("cap");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());

        // The shim runs on every hook event of every session, so the file must
        // not grow without bound. Past the cap it restarts rather than rotating
        // — the recent lines are the ones a report needs.
        append_capped(&path, "0123456789", 8);
        append_capped(&path, "after", 8);

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "after\n");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
