//! PTY session lifecycle: spawn a shell, stream its output to the frontend,
//! and forward input, resize and close requests back to it.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtyPair, PtySize};
use tauri::ipc::{Channel, Response};

use super::shell::{autosuggest_env, login_args, resolve_shell_with, terminal_env, usable_cwd};

/// A single live terminal session.
pub struct Session {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub shell_name: String,
}

/// Tauri-managed registry of every open session.
#[derive(Default)]
pub struct PtyState {
    sessions: RwLock<HashMap<u32, Arc<Session>>>,
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
) -> (CommandBuilder, String) {
    let shell = resolve_shell_with(shell_override);
    let mut cmd = CommandBuilder::new(&shell);
    // Run as a login shell so it sources the user's profile and inherits the
    // full PATH (Homebrew etc.); a GUI-launched non-login shell misses those.
    for arg in login_args(&shell) {
        cmd.arg(arg);
    }
    if let Some(dir) = usable_cwd(cwd) {
        cmd.cwd(dir);
    }
    // Windows has no OS-level cwd backend (no /proc, no lsof — see
    // read_process_cwd below), so the shell itself reports its cwd via OSC 7 at
    // every prompt: PowerShell through an injected prompt wrapper, cmd.exe
    // through a PROMPT prefix. The frontend parses the sequence (see
    // src/modules/terminal/lib/osc7.ts). Unix keeps the poll backend.
    #[cfg(windows)]
    {
        for arg in super::shell::windows_integration_args(&shell) {
            cmd.arg(arg);
        }
        let inherited_prompt = std::env::var("PROMPT").ok();
        for (key, value) in super::shell::windows_integration_env(&shell, inherited_prompt) {
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
    // Drop the slave so EOF propagates to the reader once the child exits.
    drop(pair.slave);

    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let session = Arc::new(Session {
        writer: Arc::new(Mutex::new(writer)),
        master: Mutex::new(pair.master),
        killer: Mutex::new(killer),
        shell_name,
    });

    let id = state.alloc_id();
    state.sessions.write().unwrap().insert(id, session);

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if !on_bytes(buf[..n].to_vec()) {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1);
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
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let (cmd, shell_name) = build_shell_command(cwd, suggestions, shell_override);

    // Best-effort per-session logger; failure to start logging must not block
    // opening the terminal, so we discard the error and just don't log.
    let log_tx = crate::modules::session_log::start_logger(app, &shell_name)
        .ok()
        .map(|h| h.tx);

    spawn_with_sinks(
        state,
        cols,
        rows,
        cmd,
        shell_name,
        move |bytes| {
            if let Some(tx) = &log_tx {
                // Drop on a full channel rather than stall the reader thread.
                let _ = tx.try_send(bytes.clone());
            }
            on_data.send(Response::new(bytes)).is_ok()
        },
        move |code| {
            let _ = on_exit.send(code);
        },
    )
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
    use std::sync::mpsc;
    use std::time::Duration;

    fn collect_command_output(program: &str, args: &[&str]) -> String {
        let state = PtyState::new();
        let mut cmd = CommandBuilder::new(program);
        for arg in args {
            cmd.arg(arg);
        }

        let collected = Arc::new(Mutex::new(Vec::<u8>::new()));
        let sink = collected.clone();
        let (exit_tx, exit_rx) = mpsc::channel::<i32>();

        spawn_with_sinks(
            &state,
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

        exit_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("command should exit within timeout");

        let bytes = collected.lock().unwrap().clone();
        String::from_utf8_lossy(&bytes).into_owned()
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
        let id = spawn_with_sinks(&state, 80, 24, cmd, "echo".to_string(), |_| true, |_| {})
            .expect("spawn should succeed");
        assert!(state.get(id).is_ok());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn decodes_lsof_escaped_non_ascii_back_to_utf8() {
        // lsof -Fn prints non-ASCII bytes as literal \xHH; decode them back.
        assert_eq!(decode_lsof_name("/a/\\xe6\\x96\\x87"), "/a/文");
        // Plain ASCII paths are unchanged; an escaped backslash becomes one.
        assert_eq!(decode_lsof_name("/Users/muki/Documents"), "/Users/muki/Documents");
        assert_eq!(decode_lsof_name("/a/b\\\\c"), "/a/b\\c");
        // Standard C escapes for control characters are decoded too.
        assert_eq!(decode_lsof_name("/a/b\\tc"), "/a/b\tc");
    }
}
