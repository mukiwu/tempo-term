//! PTY session lifecycle: spawn a shell, stream its output to the frontend,
//! and forward input, resize and close requests back to it.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtyPair, PtySize};
use tauri::ipc::{Channel, Response};

use super::shell::{resolve_shell, terminal_env};

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
fn build_shell_command(cwd: Option<String>) -> (CommandBuilder, String) {
    let shell = resolve_shell();
    let mut cmd = CommandBuilder::new(&shell);
    if let Some(dir) = cwd.filter(|d| !d.trim().is_empty()) {
        cmd.cwd(dir);
    }
    for (key, value) in terminal_env(std::env::var("LANG").ok()) {
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
/// channels.
pub fn spawn(
    state: &PtyState,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let (cmd, shell_name) = build_shell_command(cwd);
    spawn_with_sinks(
        state,
        cols,
        rows,
        cmd,
        shell_name,
        move |bytes| on_data.send(Response::new(bytes)).is_ok(),
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
}
