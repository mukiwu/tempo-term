//! PTY session lifecycle: spawn a shell, stream its output to the frontend,
//! and forward input, resize and close requests back to it.

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtyPair, PtySize};
use tauri::ipc::{Channel, Response};

use super::shell::{
    adjust_shell_for_unc_cwd, autosuggest_env, login_args, resolve_shell_with, terminal_env,
    usable_cwd,
};

/// A single live terminal session.
pub struct Session {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub shell_name: String,
    owner_label: Mutex<Option<String>>,
    output: Mutex<Option<Arc<OutputHub>>>,
}

const OUTPUT_BACKLOG_CAP: usize = 1_000_000;
const OUTPUT_SEND_CHUNK: usize = 64 * 1024;

struct OutputSink {
    data: Channel<Response>,
    exit: Channel<i32>,
    cursor: u64,
}

struct OutputHubInner {
    backlog: VecDeque<u8>,
    truncated: bool,
    sink: Option<OutputSink>,
    exit_code: Option<i32>,
    start_seq: u64,
    next_seq: u64,
    active: bool,
}

/// Renderer-independent PTY output. A WKWebView can be suspended or replaced
/// while its shell remains alive; failed Channels are detached and the rolling
/// backlog is replayed to a newly attached renderer instead of stopping the
/// PTY reader (which previously orphaned the shell after a reload).
struct OutputHub(Mutex<OutputHubInner>);

impl OutputHub {
    fn new(data: Channel<Response>, exit: Channel<i32>) -> Self {
        Self(Mutex::new(OutputHubInner {
            backlog: VecDeque::new(),
            truncated: false,
            sink: Some(OutputSink {
                data,
                exit,
                cursor: 0,
            }),
            exit_code: None,
            start_seq: 0,
            next_seq: 0,
            active: true,
        }))
    }

    fn publish(&self, bytes: Vec<u8>) {
        let mut inner = self.0.lock().unwrap();
        inner.backlog.extend(bytes.iter().copied());
        inner.next_seq = inner.next_seq.saturating_add(bytes.len() as u64);
        while inner.backlog.len() > OUTPUT_BACKLOG_CAP {
            inner.backlog.pop_front();
            inner.start_seq = inner.start_seq.saturating_add(1);
            inner.truncated = true;
        }
        if inner.active {
            let next = inner.next_seq;
            if let Some(sink) = inner.sink.as_mut() {
                if sink.data.send(Response::new(bytes)).is_err() {
                    inner.sink = None;
                } else {
                    sink.cursor = next;
                }
            }
        }
    }

    fn finish(&self, code: i32) {
        let mut inner = self.0.lock().unwrap();
        inner.exit_code = Some(code);
        if let Some(sink) = inner.sink.take() {
            let _ = sink.exit.send(code);
        }
    }

    fn attach(&self, data: Channel<Response>, exit: Channel<i32>) -> bool {
        let mut inner = self.0.lock().unwrap();
        if !inner.active {
            let cursor = inner.start_seq;
            inner.sink = Some(OutputSink { data, exit, cursor });
            return inner.truncated;
        }
        let mut replay = Vec::with_capacity(inner.backlog.len() + 96);
        if inner.truncated {
            replay.extend_from_slice(
                b"\r\n\x1b[33m[TempoTerm: earlier recovery output was truncated]\x1b[0m\r\n",
            );
        }
        replay.extend(inner.backlog.iter().copied());
        for chunk in replay.chunks(OUTPUT_SEND_CHUNK) {
            if data.send(Response::new(chunk.to_vec())).is_err() {
                inner.sink = None;
                return inner.truncated;
            }
        }
        if let Some(code) = inner.exit_code {
            let _ = exit.send(code);
        } else {
            let cursor = inner.next_seq;
            inner.sink = Some(OutputSink { data, exit, cursor });
        }
        inner.truncated
    }

    fn set_active(&self, active: bool) {
        let mut inner = self.0.lock().unwrap();
        if inner.active == active {
            return;
        }
        inner.active = active;
        if !active {
            return;
        }
        let start_seq = inner.start_seq;
        let next_seq = inner.next_seq;
        let backlog: Vec<u8> = inner.backlog.iter().copied().collect();
        if let Some(sink) = inner.sink.as_mut() {
            let was_truncated = sink.cursor < start_seq;
            let offset = sink.cursor.max(start_seq).saturating_sub(start_seq) as usize;
            let mut pending = Vec::new();
            if was_truncated {
                pending.extend_from_slice(
                    b"\r\n\x1b[33m[TempoTerm: background output was truncated]\x1b[0m\r\n",
                );
            }
            pending.extend_from_slice(&backlog[offset.min(backlog.len())..]);
            for chunk in pending.chunks(OUTPUT_SEND_CHUNK) {
                if sink.data.send(Response::new(chunk.to_vec())).is_err() {
                    inner.sink = None;
                    return;
                }
            }
            sink.cursor = next_seq;
        }
    }

    fn is_truncated(&self) -> bool {
        self.0.lock().unwrap().truncated
    }
}

/// Tauri-managed registry of every open session. The map is behind an `Arc`
/// so each session's waiter thread can prune its own entry on child exit
/// (see `spawn_with_sinks`).
#[derive(Default)]
pub struct PtyState {
    sessions: Arc<RwLock<HashMap<u32, Arc<Session>>>>,
    next_id: AtomicU32,
}

impl PtyState {
    pub fn new() -> Self {
        Self::default()
    }

    fn alloc_id(&self) -> u32 {
        self.next_id.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn get(&self, id: u32) -> Result<Arc<Session>, String> {
        self.sessions
            .read()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("pty session {id} not found"))
    }
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Build the shell command and its display name from the live environment.
/// `suggestions` is the user's "suggest previous commands" setting, passed per
/// spawn so a freshly opened (or restored) session reflects the current value.
fn build_shell_command(
    cwd: Option<String>,
    suggestions: bool,
    shell_override: Option<String>,
    status_env: Vec<(String, String)>,
) -> (CommandBuilder, String) {
    // Resolve the start directory before picking the shell: on Windows the
    // choice depends on it (cmd.exe cannot start in a UNC directory).
    let cwd = usable_cwd(cwd);
    let override_present = shell_override
        .as_deref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let shell = adjust_shell_for_unc_cwd(
        resolve_shell_with(shell_override),
        override_present,
        cwd.as_deref(),
        cfg!(windows),
    );
    let mut cmd = CommandBuilder::new(&shell);
    // Run as a login shell so it sources the user's profile and inherits the
    // full PATH (Homebrew etc.); a GUI-launched non-login shell misses those.
    for arg in login_args(&shell) {
        cmd.arg(arg);
    }
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    // Windows has no OS-level cwd backend (no /proc, no lsof — see
    // read_process_cwd below), so the shell itself reports its cwd via OSC 7 at
    // every prompt: PowerShell through an injected prompt wrapper, cmd.exe
    // through a PROMPT prefix, bash through PROMPT_COMMAND. The frontend parses
    // the sequence (see src/modules/terminal/lib/osc7.ts). Unix keeps the poll
    // backend.
    #[cfg(windows)]
    {
        for arg in super::shell::windows_integration_args(&shell) {
            cmd.arg(arg);
        }
        let inherited_prompt = std::env::var("PROMPT").ok();
        let inherited_prompt_command = std::env::var("PROMPT_COMMAND").ok();
        for (key, value) in super::shell::windows_integration_env(
            &shell,
            inherited_prompt,
            inherited_prompt_command,
        ) {
            cmd.env(key, value);
        }
    }
    let locale_env = terminal_env(
        std::env::var("LC_ALL").ok(),
        std::env::var("LC_CTYPE").ok(),
        std::env::var("LANG").ok(),
    );
    for (key, value) in locale_env {
        cmd.env(key, value);
    }
    // Marks this shell (and anything it launches, like Claude Code) as running
    // inside tempo-term. The session-status hook only emits when it sees this,
    // so Claude sessions in other terminals never touch our UI.
    cmd.env("TEMPOTERM", "1");

    // Tell CLI tools like Claude Code (via supports-hyperlinks) that we support OSC 8 hyperlinks natively.
    cmd.env("FORCE_HYPERLINK", "1");

    // Point this pane's status-hook shim back at the app's loopback listener
    // and tag it with the pane's pty id (see status_ipc). Empty when the
    // listener failed to start.
    for (key, value) in status_env {
        cmd.env(key, value);
    }

    // When enabled, point zsh at a wrapper ZDOTDIR that loads the user's config
    // and then the bundled autosuggestions plugin. No-op for non-zsh shells.
    for (key, value) in autosuggest_env(&shell, suggestions) {
        cmd.env(key, value);
    }

    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(shell.as_str())
        .to_string();

    (cmd, shell_name)
}

/// Core spawn used by both the Tauri command and tests. Runs `cmd` in a fresh
/// PTY, streams every output chunk through `on_bytes` (returning `false` stops
/// reading) and reports the exit code through `on_exit`.
pub fn spawn_with_sinks(
    state: &PtyState,
    id: u32,
    cols: u16,
    rows: u16,
    cmd: CommandBuilder,
    shell_name: String,
    on_bytes: impl Fn(Vec<u8>) -> bool + Send + 'static,
    on_exit: impl FnOnce(i32) + Send + 'static,
) -> Result<u32, String> {
    let pair: PtyPair = native_pty_system()
        .openpty(pty_size(cols, rows))
        .map_err(|e| e.to_string())?;

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // Drop the slave so EOF propagates to the reader once the child exits
    // (unix; on Windows EOF needs the pseudo console closed — see the waiter
    // thread below).
    drop(pair.slave);

    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let session = Arc::new(Session {
        writer: Arc::new(Mutex::new(writer)),
        master: Mutex::new(pair.master),
        killer: Mutex::new(killer),
        shell_name,
        owner_label: Mutex::new(None),
        output: Mutex::new(None),
    });

    state.sessions.write().unwrap().insert(id, session);

    // Waiter thread: detect child exit directly instead of inferring it from
    // reader EOF. On Windows ConPTY the reader NEVER sees EOF while the pseudo
    // console is open (microsoft/terminal#1810), and the master lives in the
    // registry — so waiting for EOF before `child.wait()` deadlocks there and
    // a pane whose shell ran `exit` hangs forever. Waiting first and pruning
    // the session is what closes the pseudo console and unblocks the reader;
    // on unix the reader gets EOF on its own and this just prunes early. The
    // exit code crosses to the flusher thread, which still reports `on_exit`
    // only after the remaining output has been flushed.
    let sessions = Arc::clone(&state.sessions);
    let (exit_code_tx, exit_code_rx) = std::sync::mpsc::channel::<i32>();
    std::thread::spawn(move || {
        let code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1);
        sessions.write().unwrap().remove(&id);
        let _ = exit_code_tx.send(code);
    });

    // Coalesce PTY output before it crosses the IPC boundary. The old design sent
    // one Tauri message per 8 KB read; under a heavy stream (e.g. several Claude
    // sessions) that is hundreds of main-thread IPC round-trips per second on the
    // webview side, which saturates the single UI thread. Here a reader thread does
    // the blocking reads and hands chunks to a flusher thread, which batches
    // everything arriving within a short window (or up to a size cap) into ONE
    // `on_bytes` call — collapsing a burst of reads into a handful of sends — while
    // still flushing within FLUSH_WINDOW so an idle prompt stays responsive.
    std::thread::spawn(move || {
        use std::sync::mpsc::{sync_channel, RecvTimeoutError};
        use std::time::{Duration, Instant};

        // ~12 ms is under one frame, so output latency stays imperceptible; 64 KB
        // caps a single batch so a very fast stream still flushes promptly.
        const FLUSH_WINDOW: Duration = Duration::from_millis(12);
        const FLUSH_BYTES: usize = 64 * 1024;

        // Bounded so a wedged frontend backpressures the shell instead of growing
        // memory without limit (512 * 8 KB ~= 4 MB worst case).
        let (tx, rx) = sync_channel::<Vec<u8>>(512);
        let reader_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break; // Flusher stopped (frontend closed the channel).
                        }
                    }
                    Err(_) => break,
                }
            }
            // Dropping `tx` disconnects the channel so the flusher drains any
            // remaining chunks and stops.
        });

        'flush: loop {
            // Block until the first chunk of a new window (or the reader is done).
            let mut acc = match rx.recv() {
                Ok(chunk) => chunk,
                Err(_) => break, // Disconnected with nothing pending.
            };
            let deadline = Instant::now() + FLUSH_WINDOW;
            while acc.len() < FLUSH_BYTES {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break;
                }
                match rx.recv_timeout(remaining) {
                    Ok(chunk) => acc.extend(chunk),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => {
                        // Reader finished mid-window: flush what we have, then stop.
                        let _ = on_bytes(acc);
                        break 'flush;
                    }
                }
            }
            if !on_bytes(acc) {
                break; // Sink asked to stop.
            }
        }

        // Drop the receiver BEFORE joining. If the reader is blocked on a full
        // channel `tx.send`, closing `rx` makes that send return an error so the
        // reader loop exits; otherwise `join()` — and thus `on_exit` — would
        // deadlock and leak both threads.
        drop(rx);
        let _ = reader_thread.join();
        // The waiter thread owns `child.wait()`; recv fails only if it died.
        let code = exit_code_rx.recv().unwrap_or(-1);
        on_exit(code);
    });

    Ok(id)
}

/// Spawn the user's shell and bridge its IO to the frontend over Tauri
/// channels. Every output chunk is also tee'd into a per-session `.log` file
/// via the session_log writer.
pub fn spawn(
    state: &PtyState,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    suggestions: bool,
    shell_override: Option<String>,
    app: &tauri::AppHandle,
    owner_label: String,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    // Allocate the pty id up front so it can tag this pane's status env (the
    // frontend matches session-status events back to the pane by this id).
    let id = state.alloc_id();

    // Hand the pane the loopback address + token + its id so its status-hook
    // shim can report state (see status_ipc).
    let status_env = {
        use tauri::Manager;
        app.try_state::<crate::modules::status_ipc::StatusIpc>()
            .map(|ipc| ipc.env_for(id))
            .unwrap_or_default()
    };

    let (cmd, shell_name) = build_shell_command(cwd, suggestions, shell_override, status_env);

    // Best-effort per-session logger; failure to start logging must not block
    // opening the terminal, so we discard the error and just don't log.
    let log_tx = crate::modules::session_log::start_logger(app, &shell_name)
        .ok()
        .map(|h| h.tx);

    let hub = Arc::new(OutputHub::new(on_data, on_exit));
    let output_hub = Arc::clone(&hub);
    let exit_hub = Arc::clone(&hub);
    let result = spawn_with_sinks(
        state,
        id,
        cols,
        rows,
        cmd,
        shell_name,
        move |bytes| {
            if let Some(tx) = &log_tx {
                // Drop on a full channel rather than stall the reader thread.
                let _ = tx.try_send(bytes.clone());
            }
            output_hub.publish(bytes);
            true
        },
        move |code| {
            exit_hub.finish(code);
        },
    );
    if result.is_ok() {
        let session = state.get(id)?;
        *session.owner_label.lock().unwrap() = Some(owner_label);
        *session.output.lock().unwrap() = Some(hub);
    }
    result
}

pub fn attach(
    state: &PtyState,
    id: u32,
    owner_label: &str,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<bool, String> {
    let session = state.get(id)?;
    if session.owner_label.lock().unwrap().as_deref() != Some(owner_label) {
        return Err("pty session belongs to another window".to_string());
    }
    let hub = session
        .output
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "pty session is not attachable".to_string())?;
    Ok(hub.attach(on_data, on_exit))
}

pub fn set_window_active(state: &PtyState, owner_label: &str, active: bool) {
    let sessions: Vec<Arc<Session>> = state.sessions.read().unwrap().values().cloned().collect();
    for session in sessions {
        if session.owner_label.lock().unwrap().as_deref() == Some(owner_label) {
            if let Some(hub) = session.output.lock().unwrap().clone() {
                hub.set_active(active);
            }
        }
    }
}

pub fn recovery_stats(state: &PtyState, owner_label: &str) -> (usize, bool) {
    let sessions: Vec<Arc<Session>> = state.sessions.read().unwrap().values().cloned().collect();
    let mut count = 0;
    let mut truncated = false;
    for session in sessions {
        if session.owner_label.lock().unwrap().as_deref() == Some(owner_label) {
            count += 1;
            truncated |= session
                .output
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|hub| hub.is_truncated());
        }
    }
    (count, truncated)
}

pub fn session_count(state: &PtyState) -> usize {
    state.sessions.read().unwrap().len()
}

pub fn owned_count(state: &PtyState, owner_label: &str) -> usize {
    state
        .sessions
        .read()
        .unwrap()
        .values()
        .filter(|session| session.owner_label.lock().unwrap().as_deref() == Some(owner_label))
        .count()
}

pub fn close_owned(state: &PtyState, owner_label: &str) {
    let ids: Vec<u32> = state
        .sessions
        .read()
        .unwrap()
        .iter()
        .filter_map(|(id, session)| {
            (session.owner_label.lock().unwrap().as_deref() == Some(owner_label)).then_some(*id)
        })
        .collect();
    for id in ids {
        close(state, id);
    }
}

pub fn write_input(state: &PtyState, id: u32, data: &[u8]) -> Result<(), String> {
    let session = state.get(id)?;
    let mut writer = session.writer.lock().unwrap();
    writer.write_all(data).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

pub fn resize(state: &PtyState, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let session = state.get(id)?;
    let result = session
        .master
        .lock()
        .unwrap()
        .resize(pty_size(cols, rows))
        .map_err(|e| e.to_string());
    result
}

pub fn shell_name(state: &PtyState, id: u32) -> Result<String, String> {
    Ok(state.get(id)?.shell_name.clone())
}

pub fn foreground_command(state: &PtyState, id: u32) -> Result<Option<String>, String> {
    let session = state.get(id)?;
    Ok(foreground_pid(&session).and_then(read_process_command))
}

/// The working directory of the terminal's foreground process (the shell when
/// sitting at a prompt). Lets the file explorer follow `cd`.
pub fn cwd(state: &PtyState, id: u32) -> Result<Option<String>, String> {
    let session = state.get(id)?;
    Ok(foreground_pid(&session).and_then(read_process_cwd))
}

/// PID of the terminal's foreground process group. `portable-pty` exposes
/// `process_group_leader` only on Unix (Windows has no process-group concept),
/// so on other platforms this returns `None` and the cwd / foreground-command
/// commands simply report nothing there. Windows gets its cwd a different way:
/// the injected shell integration (see `windows_integration_args` /
/// `windows_integration_env` in shell.rs) makes the shell announce its own
/// directory via OSC 7, parsed on the frontend.
#[cfg(unix)]
fn foreground_pid(session: &Session) -> Option<i32> {
    session.master.lock().unwrap().process_group_leader()
}

#[cfg(not(unix))]
fn foreground_pid(_session: &Session) -> Option<i32> {
    None
}

/// lsof `-Fn` escapes non-printable/non-ASCII bytes as literal `\xHH` text (and
/// `\` as `\\`). Decode those back to the original bytes so a non-ASCII path
/// (e.g. a Chinese folder name) is real UTF-8 rather than a literal `\xe6...`.
#[cfg(target_os = "macos")]
fn decode_lsof_name(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            if bytes[i + 1] == b'x' && i + 3 < bytes.len() {
                let hi = (bytes[i + 2] as char).to_digit(16);
                let lo = (bytes[i + 3] as char).to_digit(16);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    out.push((hi * 16 + lo) as u8);
                    i += 4;
                    continue;
                }
            }
            // lsof also uses standard C escapes for control characters.
            let escaped = match bytes[i + 1] {
                b'\\' => Some(b'\\'),
                b'a' => Some(0x07),
                b'b' => Some(0x08),
                b'f' => Some(0x0c),
                b'n' => Some(b'\n'),
                b'r' => Some(b'\r'),
                b't' => Some(b'\t'),
                b'v' => Some(0x0b),
                _ => None,
            };
            if let Some(byte) = escaped {
                out.push(byte);
                i += 2;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    // Reuse the buffer when it is already valid UTF-8 (the normal case); only
    // fall back to lossy replacement for genuinely invalid bytes.
    String::from_utf8(out).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

#[cfg(target_os = "macos")]
fn read_process_cwd(pid: i32) -> Option<String> {
    let output = std::process::Command::new("lsof")
        .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.strip_prefix('n').map(|p| decode_lsof_name(p)))
}

#[cfg(target_os = "linux")]
fn read_process_cwd(pid: i32) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn read_process_cwd(_pid: i32) -> Option<String> {
    None
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn read_process_command(pid: i32) -> Option<String> {
    let output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .ok()?;
    let command = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!command.is_empty()).then_some(command)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn read_process_command(_pid: i32) -> Option<String> {
    None
}

pub fn close(state: &PtyState, id: u32) {
    if let Some(session) = state.sessions.write().unwrap().remove(&id) {
        let _ = session.killer.lock().unwrap().kill();
    }
}

pub fn close_all(state: &PtyState) {
    let drained: Vec<Arc<Session>> = {
        let mut map = state.sessions.write().unwrap();
        map.drain().map(|(_, s)| s).collect()
    };
    for session in drained {
        let _ = session.killer.lock().unwrap().kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::InvokeResponseBody;

    fn test_channels() -> (Channel<Response>, Channel<i32>, Arc<Mutex<Vec<Vec<u8>>>>) {
        let messages = Arc::new(Mutex::new(Vec::new()));
        let captured = messages.clone();
        let data = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(bytes) = body {
                captured.lock().unwrap().push(bytes);
            }
            Ok(())
        });
        let exit = Channel::new(|_| Ok(()));
        (data, exit, messages)
    }

    #[test]
    fn output_hub_mutes_background_ipc_and_flushes_in_order() {
        let (data, exit, messages) = test_channels();
        let hub = OutputHub::new(data, exit);
        hub.publish(b"before".to_vec());
        hub.set_active(false);
        hub.publish(b"during-1".to_vec());
        hub.publish(b"during-2".to_vec());
        assert_eq!(messages.lock().unwrap().concat(), b"before");
        hub.set_active(true);
        assert_eq!(messages.lock().unwrap().concat(), b"beforeduring-1during-2");
    }

    #[test]
    fn output_hub_attach_replaces_sink_and_replays_backlog() {
        let (first_data, first_exit, first) = test_channels();
        let hub = OutputHub::new(first_data, first_exit);
        hub.publish(b"one".to_vec());
        let (second_data, second_exit, second) = test_channels();
        assert!(!hub.attach(second_data, second_exit));
        hub.publish(b"two".to_vec());
        assert_eq!(first.lock().unwrap().concat(), b"one");
        assert_eq!(second.lock().unwrap().concat(), b"onetwo");
    }

    #[test]
    fn output_hub_backlog_is_bounded_and_marks_truncation() {
        let (data, exit, _) = test_channels();
        let hub = OutputHub::new(data, exit);
        hub.publish(vec![b'x'; OUTPUT_BACKLOG_CAP + 17]);
        let inner = hub.0.lock().unwrap();
        assert_eq!(inner.backlog.len(), OUTPUT_BACKLOG_CAP);
        assert!(inner.truncated);
        assert_eq!(inner.start_seq, 17);
    }
    use std::sync::mpsc;
    use std::time::Duration;

    fn collect_builder_output(cmd: CommandBuilder) -> (String, i32) {
        let state = PtyState::new();
        let collected = Arc::new(Mutex::new(Vec::<u8>::new()));
        let sink = collected.clone();
        let (exit_tx, exit_rx) = mpsc::channel::<i32>();

        spawn_with_sinks(
            &state,
            state.alloc_id(),
            80,
            24,
            cmd,
            "test".to_string(),
            move |bytes| {
                sink.lock().unwrap().extend_from_slice(&bytes);
                true
            },
            move |code| {
                let _ = exit_tx.send(code);
            },
        )
        .expect("spawn should succeed");

        let code = exit_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("command should exit within timeout");

        let bytes = collected.lock().unwrap().clone();
        (String::from_utf8_lossy(&bytes).into_owned(), code)
    }

    fn collect_command_output(program: &str, args: &[&str]) -> String {
        let mut cmd = CommandBuilder::new(program);
        for arg in args {
            cmd.arg(arg);
        }
        collect_builder_output(cmd).0
    }

    #[test]
    fn streams_ascii_output_and_reports_exit() {
        let output = collect_command_output("/bin/echo", &["hello-tempo"]);
        assert!(
            output.contains("hello-tempo"),
            "expected echoed text in PTY output, got: {output:?}"
        );
    }

    #[test]
    fn streams_multibyte_cjk_output_intact() {
        let output = collect_command_output("/bin/echo", &["你好世界"]);
        assert!(
            output.contains("你好世界"),
            "expected CJK text to survive the PTY byte stream, got: {output:?}"
        );
    }

    #[test]
    fn registers_session_in_state() {
        let state = PtyState::new();
        let cmd = CommandBuilder::new("/bin/echo");
        let id = spawn_with_sinks(
            &state,
            state.alloc_id(),
            80,
            24,
            cmd,
            "echo".to_string(),
            |_| true,
            |_| {},
        )
        .expect("spawn should succeed");
        assert!(state.get(id).is_ok());
    }

    #[test]
    fn removes_the_session_once_the_child_exits() {
        // The waiter thread must prune the registry before the exit event is
        // delivered: dropping the session (and its master) is what closes the
        // pseudo console on Windows so the blocked reader can see EOF at all
        // (microsoft/terminal#1810) — a session left in the map after exit
        // means Windows panes hang forever on `exit`.
        let state = PtyState::new();
        let cmd = CommandBuilder::new("/bin/echo");
        let (exit_tx, exit_rx) = mpsc::channel::<i32>();
        let id = spawn_with_sinks(
            &state,
            state.alloc_id(),
            80,
            24,
            cmd,
            "echo".to_string(),
            |_| true,
            move |code| {
                let _ = exit_tx.send(code);
            },
        )
        .expect("spawn should succeed");

        exit_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("command should exit within timeout");
        assert!(
            state.get(id).is_err(),
            "session should be pruned from the registry before the exit event fires"
        );
    }

    #[cfg(unix)]
    #[test]
    fn preserves_command_environment_and_working_directory() {
        // macOS exposes the temp directory through `/var`, while the shell's
        // `PWD` resolves the same directory through `/private/var`.
        let expected_cwd = std::env::temp_dir()
            .canonicalize()
            .expect("canonicalize temp directory");
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "printf '%s|%s' \"$TEMPOTERM_PTY_TEST\" \"$PWD\""]);
        cmd.cwd(&expected_cwd);
        cmd.env("TEMPOTERM_PTY_TEST", "環境正常");

        let (output, code) = collect_builder_output(cmd);

        assert_eq!(code, 0);
        assert!(
            output.contains(&format!("環境正常|{}", expected_cwd.display())),
            "expected cwd and environment in PTY output, got: {output:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn resize_reaches_the_child_terminal() {
        let state = PtyState::new();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "read _line; stty size"]);
        let collected = Arc::new(Mutex::new(Vec::<u8>::new()));
        let sink = Arc::clone(&collected);
        let (exit_tx, exit_rx) = mpsc::channel::<i32>();
        let id = spawn_with_sinks(
            &state,
            state.alloc_id(),
            80,
            24,
            cmd,
            "sh".to_string(),
            move |bytes| {
                sink.lock().unwrap().extend_from_slice(&bytes);
                true
            },
            move |code| {
                let _ = exit_tx.send(code);
            },
        )
        .expect("spawn shell");

        resize(&state, id, 132, 43).expect("resize PTY");
        write_input(&state, id, b"continue\r").expect("release child after resize");
        assert_eq!(
            exit_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("resized shell should exit"),
            0
        );
        let output = String::from_utf8_lossy(&collected.lock().unwrap()).into_owned();
        assert!(
            output.contains("43 132"),
            "child should observe 43 rows and 132 columns, got: {output:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn ctrl_c_reaches_the_foreground_process_group() {
        use std::time::Instant;

        let state = PtyState::new();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args([
            "-c",
            "trap 'printf interrupted; exit 42' INT; printf ready; while :; do sleep 1; done",
        ]);
        let collected = Arc::new(Mutex::new(Vec::<u8>::new()));
        let sink = Arc::clone(&collected);
        let (exit_tx, exit_rx) = mpsc::channel::<i32>();
        let id = spawn_with_sinks(
            &state,
            state.alloc_id(),
            80,
            24,
            cmd,
            "sh".to_string(),
            move |bytes| {
                sink.lock().unwrap().extend_from_slice(&bytes);
                true
            },
            move |code| {
                let _ = exit_tx.send(code);
            },
        )
        .expect("spawn signal test shell");

        let deadline = Instant::now() + Duration::from_secs(5);
        while !collected.lock().unwrap().windows(5).any(|w| w == b"ready") {
            assert!(Instant::now() < deadline, "shell did not become ready");
            std::thread::sleep(Duration::from_millis(10));
        }
        write_input(&state, id, &[3]).expect("send Ctrl+C");

        assert_eq!(
            exit_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("interrupted shell should exit"),
            42
        );
        let output = String::from_utf8_lossy(&collected.lock().unwrap()).into_owned();
        assert!(
            output.contains("interrupted"),
            "trap output missing: {output:?}"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn repeatedly_spawns_ptys_while_other_threads_churn_memory_and_fds() {
        use std::fs::File;
        use std::sync::atomic::{AtomicBool, Ordering};

        let running = Arc::new(AtomicBool::new(true));
        let churn_flag = Arc::clone(&running);
        let churn = std::thread::spawn(move || {
            while churn_flag.load(Ordering::Relaxed) {
                let bytes = vec![0x5a_u8; 16 * 1024];
                std::hint::black_box(&bytes);
                let _ = File::open("/dev/null");
            }
        });

        let mut failure = None;
        for iteration in 0..100 {
            // Keep the child alive for one scheduler tick. The dedicated
            // single-spawn tests cover instant `/bin/echo`; this stress case
            // is about repeatedly crossing fork/exec while sibling threads
            // are actively touching allocator and descriptor state.
            let output = collect_command_output("/bin/sh", &["-c", "printf pty-ok; sleep 0.01"]);
            if !output.contains("pty-ok") {
                failure = Some(format!("PTY spawn {iteration} lost output: {output:?}"));
                break;
            }
        }

        running.store(false, Ordering::Relaxed);
        churn.join().expect("churn thread should stop cleanly");
        assert!(failure.is_none(), "{}", failure.unwrap_or_default());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn decodes_lsof_escaped_non_ascii_back_to_utf8() {
        // lsof -Fn prints non-ASCII bytes as literal \xHH; decode them back.
        assert_eq!(decode_lsof_name("/a/\\xe6\\x96\\x87"), "/a/文");
        // Plain ASCII paths are unchanged; an escaped backslash becomes one.
        assert_eq!(
            decode_lsof_name("/Users/muki/Documents"),
            "/Users/muki/Documents"
        );
        assert_eq!(decode_lsof_name("/a/b\\\\c"), "/a/b\\c");
        // Standard C escapes for control characters are decoded too.
        assert_eq!(decode_lsof_name("/a/b\\tc"), "/a/b\tc");
    }
}
