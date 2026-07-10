//! Session-status delivery over a loopback socket. Claude Code / Codex hooks
//! run a native shim — this very binary invoked as `tempo-term --status-hook
//! <state>` — that reports the pane's live state to a small TCP listener the
//! app runs on `127.0.0.1`. Originally built for Windows (#155), where hooks
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
}

/// Wire format sent by the shim, one message per connection:
/// `<token>\t<paneId>\t<kind>\t<payload>`. Returns the message only when the
/// token matches and the pane id parses, so a spoofed or malformed line is
/// dropped. Pure so it can be unit-tested without a socket.
pub fn parse_message(line: &str, expected_token: &str) -> Option<StatusMessage> {
    let mut parts = line.trim_end_matches(['\n', '\r']).splitn(4, '\t');
    let token = parts.next()?;
    // Constant-time-ish token check is overkill for a cosmetic loopback badge;
    // a plain compare rejects spoofers well enough.
    if token != expected_token || expected_token.is_empty() {
        return None;
    }
    let pane_id: u32 = parts.next()?.parse().ok()?;
    let kind = parts.next()?;
    let payload = parts.next().unwrap_or("");
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
    })
}

/// Build the wire line the shim sends. Kept next to `parse_message` so the two
/// stay in sync.
fn encode_message(token: &str, pane_id: &str, kind: &str, payload: &str) -> String {
    format!("{token}\t{pane_id}\t{kind}\t{payload}")
}

/// Live listener details handed to each pane so its shim can phone home.
pub struct StatusIpc {
    addr: String,
    token: String,
}

impl StatusIpc {
    /// The `(name, value)` env pairs to inject into a pane spawned as `pane_id`,
    /// so its status hook can reach us and be trusted. Returns `None` when the
    /// listener never started (then panes simply carry no status env).
    pub fn env_for(&self, pane_id: u32) -> Vec<(String, String)> {
        vec![
            (ENV_ADDR.to_string(), self.addr.clone()),
            (ENV_TOKEN.to_string(), self.token.clone()),
            (ENV_PANE_ID.to_string(), pane_id.to_string()),
        ]
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
    })
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

/// The status-hook shim: `tempo-term --status-hook <state>`. Reads the pane env
/// the app injected, then delivers one status message over loopback. Runs before
/// Tauri starts (see `run()`), does nothing outside tempo-term, and is
/// best-effort — a status ping must never fail or slow the hook that spawned it.
///
/// For the `notification` catch-all state, Claude passes the event JSON on stdin;
/// we read `notification_type` off it and forward that as the payload (kind
/// `notify`), mirroring the Unix script. Every other state forwards directly
/// (kind `status`).
pub fn run_hook_shim(state: &str) {
    if std::env::var(ENV_MARKER).ok().filter(|v| !v.is_empty()).is_none() {
        return;
    }
    let addr = match std::env::var(ENV_ADDR) {
        Ok(a) if !a.is_empty() => a,
        _ => return,
    };
    let token = std::env::var(ENV_TOKEN).unwrap_or_default();
    let pane_id = std::env::var(ENV_PANE_ID).unwrap_or_default();

    let (kind, payload) = if state == "notification" {
        let mut stdin = String::new();
        let _ = std::io::stdin().read_to_string(&mut stdin);
        match notification_type(&stdin) {
            Some(t) => ("notify", t),
            None => return, // unknown/missing type: emit nothing, like the .sh
        }
    } else {
        ("status", state.to_string())
    };

    let line = encode_message(&token, &pane_id, kind, &payload);
    send_status(&addr, &line);
}

/// Connect to `addr` and write `line`, bounded by [`SEND_TIMEOUT`] on both the
/// connect and the write so a dead or firewalled listener can never stall the
/// hook that called us. Any failure (bad address, refused/timed-out connect,
/// write error) is a silent no-op — see module docs. Split out from
/// `run_hook_shim` so the socket logic is unit-testable on its own.
fn send_status(addr: &str, line: &str) {
    let Ok(socket_addr) = addr.parse::<std::net::SocketAddr>() else { return };
    let Ok(mut stream) = TcpStream::connect_timeout(&socket_addr, SEND_TIMEOUT) else { return };
    let _ = stream.set_write_timeout(Some(SEND_TIMEOUT));
    let _ = stream.write_all(line.as_bytes());
}

/// Pull `notification_type` out of the hook's stdin JSON. Tolerant of surrounding
/// fields; returns `None` if absent so the shim stays quiet on unknown events.
fn notification_type(stdin_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(stdin_json).ok()?;
    value
        .get("notification_type")
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
        let line = encode_message(TOKEN, "7", "status", "active");
        assert_eq!(
            parse_message(&line, TOKEN),
            Some(StatusMessage { pane_id: 7, kind: "status".into(), payload: "active".into() })
        );
    }

    #[test]
    fn parses_a_notify_line() {
        let line = encode_message(TOKEN, "3", "notify", "permission_prompt");
        assert_eq!(
            parse_message(&line, TOKEN),
            Some(StatusMessage { pane_id: 3, kind: "notify".into(), payload: "permission_prompt".into() })
        );
    }

    #[test]
    fn tolerates_a_trailing_newline() {
        let line = format!("{}\n", encode_message(TOKEN, "1", "status", "idle"));
        assert!(parse_message(&line, TOKEN).is_some());
    }

    #[test]
    fn rejects_a_wrong_token() {
        let line = encode_message("attacker", "1", "status", "active");
        assert_eq!(parse_message(&line, TOKEN), None);
    }

    #[test]
    fn rejects_when_expected_token_is_empty() {
        // A blank expected token must never match (would let any sender through).
        let line = encode_message("", "1", "status", "active");
        assert_eq!(parse_message(&line, ""), None);
    }

    #[test]
    fn rejects_an_unknown_kind() {
        let line = encode_message(TOKEN, "1", "bogus", "active");
        assert_eq!(parse_message(&line, TOKEN), None);
    }

    #[test]
    fn rejects_a_non_numeric_pane_id() {
        let line = encode_message(TOKEN, "abc", "status", "active");
        assert_eq!(parse_message(&line, TOKEN), None);
    }

    #[test]
    fn rejects_an_empty_payload() {
        let line = encode_message(TOKEN, "1", "status", "");
        assert_eq!(parse_message(&line, TOKEN), None);
    }

    #[test]
    fn payload_may_contain_hyphens_but_not_tabs() {
        let line = encode_message(TOKEN, "9", "status", "waiting-approval");
        assert_eq!(parse_message(&line, TOKEN).unwrap().payload, "waiting-approval");
    }

    #[test]
    fn extracts_notification_type_from_stdin_json() {
        let json = r#"{"session_id":"x","notification_type":"idle_prompt","other":1}"#;
        assert_eq!(notification_type(json).as_deref(), Some("idle_prompt"));
    }

    #[test]
    fn notification_type_absent_or_blank_is_none() {
        assert_eq!(notification_type(r#"{"foo":"bar"}"#), None);
        assert_eq!(notification_type(r#"{"notification_type":""}"#), None);
        assert_eq!(notification_type("not json"), None);
    }

    #[test]
    fn env_for_carries_addr_token_and_pane_id() {
        let ipc = StatusIpc { addr: "127.0.0.1:5000".into(), token: "tok".into() };
        let env = ipc.env_for(42);
        assert!(env.contains(&(ENV_ADDR.to_string(), "127.0.0.1:5000".to_string())));
        assert!(env.contains(&(ENV_TOKEN.to_string(), "tok".to_string())));
        assert!(env.contains(&(ENV_PANE_ID.to_string(), "42".to_string())));
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
        send_status(&addr.to_string(), "token\t1\tstatus\tactive");
        assert!(
            start.elapsed() < std::time::Duration::from_secs(2),
            "send_status must not block waiting on a dead listener"
        );
    }

    #[test]
    fn send_status_ignores_an_unparseable_address() {
        // Not a valid SocketAddr; must return immediately rather than panic or
        // attempt a connect.
        let start = std::time::Instant::now();
        send_status("not-an-address", "token\t1\tstatus\tactive");
        assert!(start.elapsed() < std::time::Duration::from_millis(50));
    }
}
