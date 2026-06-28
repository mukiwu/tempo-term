//! SSH session manager: owns every live SSH session and the shared prompt
//! registry.
//!
//! Each session runs on its own OS thread with a dedicated current-thread tokio
//! runtime. The thread owns the russh connection end-to-end (connect → auth →
//! pty + shell → stream), and the only cross-thread channel *in* is the
//! per-session control `mpsc`. Output streams *out* to the frontend over the
//! Tauri `on_data` Channel, and the final exit code over `on_exit`. This mirrors
//! the PTY session model (one worker thread per session) so SSH and local
//! terminals behave the same way from the frontend's point of view.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, watch};

use super::client::{self, AuthArgs, ConnectArgs, VerifyingClient};
use super::forward::{self, ForwardSpec};
use super::prompt::{PromptRegistry, PromptReply};
use super::SshOpenRequest;

/// A control message sent from a Tauri command thread to a session's worker
/// thread. This is the only thing that crosses into the worker after `open`.
pub enum SshControl {
    /// Bytes the user typed, to be written to the remote shell.
    Input(Vec<u8>),
    /// The terminal was resized; tell the remote pty.
    Resize { cols: u16, rows: u16 },
    /// Start a local port forward on this live session.
    StartForward(ForwardSpec),
    /// Stop a running port forward by its id.
    StopForward(String),
    /// Tear the session down.
    Close,
}

/// The frontend-facing handle to one running session: just the sender side of
/// its control channel. The worker thread holds the receiver.
struct SshHandle {
    control: mpsc::UnboundedSender<SshControl>,
}

/// Manages all active SSH sessions and the shared prompt registry.
/// Registered as Tauri managed state so every command can access it.
pub struct SshState {
    /// id → control sender for every live session.
    sessions: Mutex<HashMap<u32, SshHandle>>,
    /// Monotonic session id allocator.
    next_id: AtomicU32,
    /// Shared registry that pairs a prompt id with the oneshot the
    /// `ssh_prompt_reply` command resolves. Cloned into each worker so its
    /// `connect`/`authenticate` prompts route back here.
    pub(crate) registry: Arc<PromptRegistry>,
}

impl SshState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(0),
            registry: Arc::new(PromptRegistry::new()),
        }
    }

    fn alloc_id(&self) -> u32 {
        self.next_id.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Forward a prompt reply to the waiting async task.
    /// Returns `true` if a pending prompt was found and resolved.
    pub fn resolve_prompt(&self, id: &str, reply: PromptReply) -> bool {
        self.registry.resolve(id, reply)
    }
}

// ---------------------------------------------------------------------------
// Open: allocate, register, spawn the worker thread.
// ---------------------------------------------------------------------------

/// Open a new SSH session. Allocates an id, registers a control channel, and
/// spawns a worker thread that drives the whole connection. Returns the id
/// immediately; the connection happens asynchronously on the worker. Output
/// arrives on `on_data`, and `on_exit` fires exactly once when the worker ends.
pub fn open(
    app: &AppHandle,
    window_label: String,
    state: &State<'_, SshState>,
    req: SshOpenRequest,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let id = state.alloc_id();
    let (control_tx, control_rx) = mpsc::unbounded_channel::<SshControl>();

    // Register the handle before spawning so a write/resize/close that races in
    // right after `open` returns can find the session. Don't hold the lock
    // across the spawn.
    state
        .sessions
        .lock()
        .unwrap()
        .insert(id, SshHandle { control: control_tx });

    let registry = state.registry.clone();
    let app = app.clone();
    let known_hosts_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("ssh_known_hosts");

    std::thread::spawn(move || {
        // Keep a handle to drop the registry entry ourselves when the worker
        // ends. `app` is moved into `run_session`, so clone for the cleanup.
        let cleanup_app = app.clone();
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(_) => {
                // Couldn't even build the runtime; report a non-zero exit so the
                // frontend tears the pane down rather than waiting forever.
                emit_line(&on_data, "ssh: could not start session runtime");
                remove_session(&cleanup_app, id);
                let _ = on_exit.send(-1);
                return;
            }
        };

        let code = rt.block_on(run_session(
            app,
            window_label,
            registry,
            known_hosts_path,
            req,
            id,
            &on_data,
            control_rx,
        ));

        // Drop our own registry entry on exit. A connection that fails async
        // (the frontend's openSsh resolved but the worker then errored) would
        // otherwise leak the handle, since the frontend never calls ssh_close
        // for a session it never saw succeed. close() from the frontend is a
        // harmless no-op once the entry is gone.
        remove_session(&cleanup_app, id);

        // `on_exit` fires exactly once, on every exit path of the worker
        // (auth failure, channel close, control Close, or error).
        let _ = on_exit.send(code);
    });

    Ok(id)
}

// ---------------------------------------------------------------------------
// run_session: the worker body. Connect, auth, pty + shell, then pump IO.
// ---------------------------------------------------------------------------

/// Drive a single SSH session to completion on the worker thread's runtime.
/// Returns the exit code: `0` for a clean end (remote EOF/close, exit status 0,
/// or an explicit Close), non-zero for an auth/connection/setup failure.
///
/// Readable failures are also written into `on_data` so the user sees *why* the
/// pane closed (e.g. `ssh: authentication failed`) instead of a silent blank.
async fn run_session(
    app: AppHandle,
    window_label: String,
    registry: Arc<PromptRegistry>,
    known_hosts_path: std::path::PathBuf,
    req: SshOpenRequest,
    session_id: u32,
    on_data: &Channel<Response>,
    mut control_rx: mpsc::UnboundedReceiver<SshControl>,
) -> i32 {
    let handler = VerifyingClient {
        app: app.clone(),
        window_label: window_label.clone(),
        registry: registry.clone(),
        known_hosts_path,
        host: req.host.clone(),
        port: req.port,
        session_id,
    };

    // Give the user immediate feedback — the connect can take a moment, and the
    // pane would otherwise sit blank until output (or an error) arrives.
    emit_line(on_data, &format!("Connecting to {}:{}...", req.host, req.port));

    // 1. Transport handshake + host-key verification.
    let mut handle = match client::connect(ConnectArgs {
        handler,
        host: req.host.clone(),
        port: req.port,
    })
    .await
    {
        Ok(handle) => handle,
        Err(e) => {
            emit_line(on_data, &format!("ssh: connection failed: {e}"));
            return 1;
        }
    };

    // 2. Authenticate. Ok(false) = server rejected; Err = operational failure.
    let auth_args = AuthArgs {
        user: req.user.clone(),
        auth_method: req.auth_method.clone(),
        key_path: req.key_path.clone(),
        connection_id: req.connection_id.clone(),
    };
    match client::authenticate(&mut handle, &auth_args, &registry, &app, &window_label, session_id)
        .await
    {
        Ok(true) => {}
        Ok(false) => {
            emit_line(on_data, "ssh: authentication failed");
            return 1;
        }
        Err(e) => {
            emit_line(on_data, &format!("ssh: authentication error: {e}"));
            return 1;
        }
    }

    // Auth is done with `handle` consumed mutably; from here the handle is only
    // used through `&self` methods (channel opens), so share it via `Arc`. Both
    // the shell channel and every port-forward listener clone this same `Arc`.
    let handle = Arc::new(handle);

    // Live port forwards: id → cancel sender. Sending `true` makes the matching
    // `run_forward` task return `Ok(())` and stop its accept loop. We always
    // drain + cancel on loop exit so no listener outlives the session.
    let mut forwards: HashMap<String, watch::Sender<bool>> = HashMap::new();

    // 3. Open a session channel and request an interactive shell on a pty.
    let channel = match handle.channel_open_session().await {
        Ok(channel) => channel,
        Err(e) => {
            emit_line(on_data, &format!("ssh: could not open channel: {e}"));
            return 1;
        }
    };
    if let Err(e) = channel
        .request_pty(
            false,
            "xterm-256color",
            req.cols as u32,
            req.rows as u32,
            0,
            0,
            &[],
        )
        .await
    {
        emit_line(on_data, &format!("ssh: could not request pty: {e}"));
        return 1;
    }
    if let Err(e) = channel.request_shell(false).await {
        emit_line(on_data, &format!("ssh: could not start shell: {e}"));
        return 1;
    }

    // 4. Split so the read loop (`wait`, &mut) and the control writes
    // (`data`/`window_change`, &) can run in the same select! without a borrow
    // conflict — `wait` needs `&mut`, the writers need `&`.
    let (mut read_half, write_half) = channel.split();

    // 5. Auto-start the forwards the request asked for. Invalid specs are
    // reported on the terminal stream and skipped, never aborting the session.
    for input in &req.forwards {
        let spec = ForwardSpec::from(input);
        if let Err(e) = forward::validate(&spec) {
            emit_line(on_data, &format!("port-forward {}: {e}", spec.local_port));
            continue;
        }
        emit_line(
            on_data,
            &format!(
                "forwarding {}:{} -> {}:{}",
                spec.bind_host, spec.local_port, spec.dest_host, spec.dest_port
            ),
        );
        let fid = spec.id.clone();
        if let Some(old) = forwards.remove(&fid) {
            let _ = old.send(true); // cancel the previous forward holding this id before replacing it
        }
        let tx = start_one(spec, handle.clone(), &app, &window_label, session_id);
        forwards.insert(fid, tx);
    }

    // Best-effort per-session logger; never let logging failures affect the
    // session. Dropping `log_tx` at the end of run_session writes the footer.
    let log_tx = if req.log_enabled {
        let label = format!("{}@{}", req.user, req.host);
        crate::modules::session_log::start_logger(&app, &label)
            .ok()
            .map(|h| h.tx)
    } else {
        None
    };

    loop {
        tokio::select! {
            // Remote → frontend. `wait` polls russh's event loop, which is what
            // keeps the connection alive on this current-thread runtime.
            msg = read_half.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { data }) => {
                        let bytes = data.to_vec();
                        if let Some(tx) = &log_tx {
                            // Best-effort: drop chunk if channel is full or writer has exited.
                            let _ = tx.try_send(bytes.clone());
                        }
                        if on_data.send(Response::new(bytes)).is_err() {
                            // Frontend channel gone (pane closed) — stop.
                            break;
                        }
                    }
                    Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                        let bytes = data.to_vec();
                        if let Some(tx) = &log_tx {
                            // Best-effort: drop chunk if channel is full or writer has exited.
                            let _ = tx.try_send(bytes.clone());
                        }
                        if on_data.send(Response::new(bytes)).is_err() {
                            break;
                        }
                    }
                    // Remote closed the channel / shell exited.
                    Some(russh::ChannelMsg::Eof)
                    | Some(russh::ChannelMsg::Close)
                    | Some(russh::ChannelMsg::ExitStatus { .. })
                    | None => break,
                    // PTY/shell request replies and other server messages don't
                    // carry terminal output; ignore and keep pumping.
                    Some(_) => {}
                }
            }

            // Frontend → remote. The control channel is the only way in.
            control = control_rx.recv() => {
                match control {
                    Some(SshControl::Input(bytes)) => {
                        // A write error means the connection is dead; end.
                        if write_half.data(&bytes[..]).await.is_err() {
                            break;
                        }
                    }
                    Some(SshControl::Resize { cols, rows }) => {
                        // Best-effort: a failed resize shouldn't kill the session.
                        let _ = write_half
                            .window_change(cols as u32, rows as u32, 0, 0)
                            .await;
                    }
                    Some(SshControl::StartForward(spec)) => {
                        let fid = spec.id.clone();
                        if let Some(old) = forwards.remove(&fid) {
                            let _ = old.send(true); // cancel the previous forward holding this id before replacing it
                        }
                        let tx = start_one(spec, handle.clone(), &app, &window_label, session_id);
                        forwards.insert(fid, tx);
                    }
                    Some(SshControl::StopForward(fid)) => {
                        if let Some(tx) = forwards.remove(&fid) {
                            // Cancel the listener task, then drop its sender.
                            let _ = tx.send(true);
                            emit_forward_status(
                                &app,
                                &window_label,
                                session_id,
                                &fid,
                                "stopped",
                                None,
                            );
                        }
                    }
                    // Close requested, or every sender dropped (session removed).
                    Some(SshControl::Close) | None => break,
                }
            }
        }
    }

    // Cancel every remaining forward before its sender drops. Sending `true`
    // first is required: if the watch sender is dropped without sending, the
    // task's `cancel.changed()` returns Err and its accept loop never exits.
    for (_, tx) in forwards.drain() {
        let _ = tx.send(true);
    }

    registry.discard_session(session_id);
    0
}

/// Write a human-readable status line to the terminal stream, CRLF-wrapped so it
/// renders cleanly in xterm. Used only for connect/auth/setup failures — never
/// for secrets. A failed send is ignored (the pane is already going away).
fn emit_line(on_data: &Channel<Response>, message: &str) {
    let line = format!("\r\n{message}\r\n");
    let _ = on_data.send(Response::new(line.into_bytes()));
}

/// Emit a `ssh-forward-status` event to the window that owns the session, so a
/// forward's lifecycle (`starting` → `active` → `stopped`/`failed`) only reaches
/// the pane that requested it instead of being broadcast to every window.
fn emit_forward_status(
    app: &AppHandle,
    window_label: &str,
    session_id: u32,
    forward_id: &str,
    state: &str,
    error: Option<&str>,
) {
    #[derive(serde::Serialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct Payload<'a> {
        session_id: u32,
        forward_id: &'a str,
        state: &'a str,
        error: Option<&'a str>,
    }
    let _ = app.emit_to(
        window_label,
        "ssh-forward-status",
        Payload {
            session_id,
            forward_id,
            state,
            error,
        },
    );
}

/// Spin up one port forward: emit `starting` then `active`, spawn the bridge
/// task, and return the cancel sender so the caller can stop it later. The task
/// emits `stopped` on a clean cancel or `failed` (with the reason) on a bind
/// error; a later `failed` overrides the optimistic `active` in the frontend.
fn start_one(
    spec: ForwardSpec,
    handle: Arc<russh::client::Handle<VerifyingClient>>,
    app: &AppHandle,
    window_label: &str,
    session_id: u32,
) -> watch::Sender<bool> {
    let (cancel_tx, cancel_rx) = watch::channel(false);
    let fid = spec.id.clone();

    emit_forward_status(app, window_label, session_id, &fid, "starting", None);
    emit_forward_status(app, window_label, session_id, &fid, "active", None);

    let app = app.clone();
    let window_label = window_label.to_string();
    tokio::spawn(async move {
        match forward::run_forward(handle, spec, cancel_rx).await {
            Ok(()) => {
                emit_forward_status(&app, &window_label, session_id, &fid, "stopped", None)
            }
            Err(e) => {
                emit_forward_status(&app, &window_label, session_id, &fid, "failed", Some(&e))
            }
        }
    });

    cancel_tx
}

// ---------------------------------------------------------------------------
// Control plane: write_input / resize / close route through the registry.
// ---------------------------------------------------------------------------

pub fn write_input(state: &State<'_, SshState>, id: u32, data: Vec<u8>) -> Result<(), String> {
    send(state, id, SshControl::Input(data))
}

pub fn resize(state: &State<'_, SshState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    send(state, id, SshControl::Resize { cols, rows })
}

/// Inner implementation of `send` that operates on `&SshState` directly
/// so it can be called from unit tests without constructing `State<'_, SshState>`.
fn send_inner(state: &SshState, id: u32, msg: SshControl) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let handle = sessions
        .get(&id)
        .ok_or_else(|| format!("ssh session {id} not found"))?;
    handle
        .control
        .send(msg)
        .map_err(|_| "ssh session closed".to_string())
}

/// Look up a session and forward a control message. Returns a readable error if
/// the session is unknown (never opened, or already closed). The lock is only
/// held to clone the sender — never across an `.await`.
fn send(state: &State<'_, SshState>, id: u32, msg: SshControl) -> Result<(), String> {
    send_inner(state, id, msg)
}

/// Inner implementation of `close` that operates on `&SshState` directly
/// for unit testing.
fn close_inner(state: &SshState, id: u32) {
    let _ = send_inner(state, id, SshControl::Close);
    state.sessions.lock().unwrap().remove(&id);
}

/// Tear a session down: signal the worker to stop, then drop the registry entry.
/// Sending may fail if the worker already exited (natural EOF) — that's fine, we
/// remove the (now stale) entry either way so the id doesn't leak.
pub fn close(state: &State<'_, SshState>, id: u32) {
    close_inner(state, id)
}

/// Drop a session's registry entry, looked up from the app's managed `SshState`.
/// Called by the worker thread on exit so a connection that fails before the
/// frontend ever calls `ssh_close` does not leak its handle.
fn remove_session(app: &AppHandle, id: u32) {
    let state = app.state::<SshState>();
    state.sessions.lock().unwrap().remove(&id);
}

// ---------------------------------------------------------------------------
// Forward control — validate up front, then hand the spec to the worker.
// ---------------------------------------------------------------------------

/// Start a port forward on an existing session. Validates the spec up front so a
/// bad rule fails the command synchronously, then sends it to the worker thread
/// which binds the local port and runs the `direct-tcpip` accept loop.
pub fn forward_start(
    state: &State<'_, SshState>,
    id: u32,
    input: super::ForwardSpecInput,
) -> Result<(), String> {
    let spec = ForwardSpec::from(&input);
    forward::validate(&spec)?;
    send_inner(state, id, SshControl::StartForward(spec))
}

/// Stop a running port forward by its id. The worker cancels the matching
/// `run_forward` task via its per-forward `watch::Sender`.
pub fn forward_stop(
    state: &State<'_, SshState>,
    id: u32,
    forward_id: String,
) -> Result<(), String> {
    send_inner(state, id, SshControl::StopForward(forward_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_prompt_unknown_is_false() {
        let state = SshState::new();
        assert!(!state.resolve_prompt(
            "x",
            PromptReply {
                approved: false,
                secret: None,
                remember: false,
            }
        ));
    }

    #[test]
    fn send_inner_unknown_id_returns_err() {
        let state = SshState::new();
        let result = send_inner(&state, 99, SshControl::Input(vec![]));
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("not found"), "expected 'not found' in: {msg}");
    }

    #[test]
    fn write_input_equivalent_unknown_id_returns_err() {
        let state = SshState::new();
        let result = send_inner(&state, 99, SshControl::Input(vec![]));
        assert!(result.is_err());
    }

    #[test]
    fn close_inner_unknown_id_is_noop() {
        let state = SshState::new();
        // Should not panic
        close_inner(&state, 99);
    }
}
