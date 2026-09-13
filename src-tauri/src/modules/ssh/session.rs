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

use std::collections::{HashMap, VecDeque};
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
#[derive(Clone)]
struct SshHandle {
    control: mpsc::UnboundedSender<SshControl>,
    owner_label: String,
    output: Arc<SshOutputHub>,
}

const BACKLOG_CAP: usize = 1_000_000;
const SEND_CHUNK: usize = 64 * 1024;

struct SshSink {
    data: Channel<Response>,
    exit: Channel<i32>,
    cursor: u64,
    needs_truncation_notice: bool,
}
struct SshOutputInner {
    backlog: VecDeque<u8>,
    sink: Option<SshSink>,
    exit_code: Option<i32>,
    start: u64,
    next: u64,
    truncated: bool,
    window_active: bool,
    pane_visible: bool,
}
struct SshOutputHub(Mutex<SshOutputInner>);

impl SshOutputHub {
    fn new(data: Channel<Response>, exit: Channel<i32>, pane_visible: bool) -> Self {
        Self(Mutex::new(SshOutputInner {
            backlog: VecDeque::new(),
            sink: Some(SshSink {
                data,
                exit,
                cursor: 0,
                needs_truncation_notice: false,
            }),
            exit_code: None,
            start: 0,
            next: 0,
            truncated: false,
            window_active: true,
            pane_visible,
        }))
    }
    fn publish(&self, bytes: Vec<u8>) {
        let mut inner = self.0.lock().unwrap();
        inner.backlog.extend(bytes.iter().copied());
        inner.next += bytes.len() as u64;
        while inner.backlog.len() > BACKLOG_CAP {
            inner.backlog.pop_front();
            inner.start += 1;
            inner.truncated = true;
        }
        if inner.window_active && inner.pane_visible {
            let next = inner.next;
            if let Some(sink) = inner.sink.as_mut() {
                if sink.data.send(Response::new(bytes)).is_err() {
                    inner.sink = None;
                } else {
                    sink.cursor = next;
                }
            }
        }
    }
    /// Save completion and report whether a renderer accepted the exit event.
    fn finish(&self, code: i32) -> bool {
        let mut inner = self.0.lock().unwrap();
        inner.exit_code = Some(code);
        // Preserve ordering for a hidden pane: buffered tail output must be
        // flushed before its exit event when the pane is shown or reattached.
        if !(inner.window_active && inner.pane_visible) {
            return false;
        }
        if let Some(sink) = inner.sink.take() {
            return sink.exit.send(code).is_ok();
        }
        false
    }
    fn attach(&self, data: Channel<Response>, exit: Channel<i32>) -> bool {
        let mut inner = self.0.lock().unwrap();
        if !(inner.window_active && inner.pane_visible) {
            let cursor = inner.start;
            let needs_truncation_notice = inner.truncated;
            inner.sink = Some(SshSink {
                data,
                exit,
                cursor,
                needs_truncation_notice,
            });
            return false;
        }
        let mut replay = Vec::new();
        replay.extend(inner.backlog.iter().copied());
        if inner.truncated {
            replay.extend_from_slice(
                b"\r\n\x1b[33m[TempoTerm: earlier SSH output was truncated]\x1b[0m\r\n",
            );
        }
        for chunk in replay.chunks(SEND_CHUNK) {
            if data.send(Response::new(chunk.to_vec())).is_err() {
                inner.sink = None;
                return false;
            }
        }
        if let Some(code) = inner.exit_code {
            exit.send(code).is_ok()
        } else {
            let cursor = inner.next;
            inner.sink = Some(SshSink {
                data,
                exit,
                cursor,
                needs_truncation_notice: false,
            });
            false
        }
    }
    fn set_window_active(&self, active: bool) -> bool {
        let mut inner = self.0.lock().unwrap();
        if inner.window_active == active {
            return false;
        }
        let was_active = inner.window_active && inner.pane_visible;
        inner.window_active = active;
        if was_active || !(inner.window_active && inner.pane_visible) {
            return false;
        }
        Self::flush_pending(&mut inner)
    }

    fn set_pane_visible(&self, visible: bool) -> bool {
        let mut inner = self.0.lock().unwrap();
        if inner.pane_visible == visible {
            return false;
        }
        let was_active = inner.window_active && inner.pane_visible;
        inner.pane_visible = visible;
        if was_active || !(inner.window_active && inner.pane_visible) {
            return false;
        }
        Self::flush_pending(&mut inner)
    }

    fn flush_pending(inner: &mut SshOutputInner) -> bool {
        let start = inner.start;
        let next = inner.next;
        let backlog: Vec<u8> = inner.backlog.iter().copied().collect();
        if let Some(mut sink) = inner.sink.take() {
            let offset = sink.cursor.max(start).saturating_sub(start) as usize;
            let mut pending = Vec::new();
            pending.extend_from_slice(&backlog[offset.min(backlog.len())..]);
            if sink.needs_truncation_notice || sink.cursor < start {
                pending.extend_from_slice(
                    b"\r\n\x1b[33m[TempoTerm: background SSH output was truncated]\x1b[0m\r\n",
                );
            }
            for chunk in pending.chunks(SEND_CHUNK) {
                if sink.data.send(Response::new(chunk.to_vec())).is_err() {
                    return false;
                }
            }
            sink.cursor = next;
            sink.needs_truncation_notice = false;
            if let Some(code) = inner.exit_code {
                return sink.exit.send(code).is_ok();
            } else {
                inner.sink = Some(sink);
            }
        }
        false
    }
    fn is_truncated(&self) -> bool {
        self.0.lock().unwrap().truncated
    }
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
    let output = Arc::new(SshOutputHub::new(on_data, on_exit, req.active));

    // Register the handle before spawning so a write/resize/close that races in
    // right after `open` returns can find the session. Don't hold the lock
    // across the spawn.
    state.sessions.lock().unwrap().insert(
        id,
        SshHandle {
            control: control_tx,
            owner_label: window_label.clone(),
            output: output.clone(),
        },
    );

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
                emit_line(&output, "ssh: could not start session runtime");
                finish_session(&cleanup_app, id, &output, -1);
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
            output.clone(),
            control_rx,
        ));

        // `on_exit` fires exactly once, on every exit path of the worker
        // (auth failure, channel close, control Close, or error). Keep the
        // registry handle as a completed tombstone when its renderer vanished,
        // so a replacement can replay the tail and acknowledge the exit.
        finish_session(&cleanup_app, id, &output, code);
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
    output: Arc<SshOutputHub>,
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
    emit_line(
        &output,
        &format!("Connecting to {}:{}...", req.host, req.port),
    );

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
            emit_line(&output, &format!("ssh: connection failed: {e}"));
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
    match client::authenticate(
        &mut handle,
        &auth_args,
        &registry,
        &app,
        &window_label,
        session_id,
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => {
            emit_line(&output, "ssh: authentication failed");
            return 1;
        }
        Err(e) => {
            emit_line(&output, &format!("ssh: authentication error: {e}"));
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
            emit_line(&output, &format!("ssh: could not open channel: {e}"));
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
        emit_line(&output, &format!("ssh: could not request pty: {e}"));
        return 1;
    }
    if let Err(e) = channel.request_shell(false).await {
        emit_line(&output, &format!("ssh: could not start shell: {e}"));
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
            emit_line(&output, &format!("port-forward {}: {e}", spec.local_port));
            continue;
        }
        emit_line(
            &output,
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
    let log_tx = {
        let label = format!("{}@{}", req.user, req.host);
        crate::modules::session_log::start_logger(&app, &label)
            .ok()
            .map(|h| h.tx)
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
                        output.publish(bytes);
                    }
                    Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                        let bytes = data.to_vec();
                        if let Some(tx) = &log_tx {
                            // Best-effort: drop chunk if channel is full or writer has exited.
                            let _ = tx.try_send(bytes.clone());
                        }
                        output.publish(bytes);
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
fn emit_line(output: &SshOutputHub, message: &str) {
    let line = format!("\r\n{message}\r\n");
    output.publish(line.into_bytes());
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
            Ok(()) => emit_forward_status(&app, &window_label, session_id, &fid, "stopped", None),
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

pub fn attach(
    state: &SshState,
    id: u32,
    owner: &str,
    active: bool,
    data: Channel<Response>,
    exit: Channel<i32>,
) -> Result<(), String> {
    let handle = state
        .sessions
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("ssh session {id} not found"))?;
    if handle.owner_label != owner {
        return Err("ssh session belongs to another window".into());
    }
    handle.output.set_pane_visible(active);
    if handle.output.attach(data, exit) {
        state.sessions.lock().unwrap().remove(&id);
    }
    Ok(())
}

pub fn set_window_active(state: &SshState, owner: &str, active: bool) {
    let hubs: Vec<_> = state
        .sessions
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(id, handle)| {
            (handle.owner_label == owner).then_some((*id, handle.output.clone()))
        })
        .collect();
    for (id, hub) in hubs {
        if hub.set_window_active(active) {
            state.sessions.lock().unwrap().remove(&id);
        }
    }
}

pub fn set_session_active(
    state: &SshState,
    id: u32,
    owner_label: &str,
    active: bool,
) -> Result<(), String> {
    let handle = state
        .sessions
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("ssh session {id} not found"))?;
    if handle.owner_label != owner_label {
        return Err("ssh session belongs to another window".to_string());
    }
    if handle.output.set_pane_visible(active) {
        state.sessions.lock().unwrap().remove(&id);
    }
    Ok(())
}

pub fn recovery_stats(state: &SshState, owner: &str) -> (usize, bool) {
    let sessions = state.sessions.lock().unwrap();
    let owned: Vec<_> = sessions
        .values()
        .filter(|handle| handle.owner_label == owner)
        .collect();
    (
        owned.len(),
        owned.iter().any(|handle| handle.output.is_truncated()),
    )
}

pub fn session_count(state: &SshState) -> usize {
    state.sessions.lock().unwrap().len()
}

pub fn owned_count(state: &SshState, owner: &str) -> usize {
    state
        .sessions
        .lock()
        .unwrap()
        .values()
        .filter(|handle| handle.owner_label == owner)
        .count()
}

pub fn close_owned(state: &SshState, owner: &str) {
    let ids: Vec<u32> = state
        .sessions
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(id, handle)| (handle.owner_label == owner).then_some(*id))
        .collect();
    for id in ids {
        close_inner(state, id);
    }
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

/// Complete a worker while retaining a replayable tombstone if the renderer's
/// Channel is gone. A successful exit delivery is the acknowledgement that lets
/// us prune the handle immediately on the ordinary (non-recovery) path.
fn finish_session(app: &AppHandle, id: u32, output: &SshOutputHub, code: i32) {
    let state = app.state::<SshState>();
    finish_session_inner(&state, id, output, code);
}

fn finish_session_inner(state: &SshState, id: u32, output: &SshOutputHub, code: i32) {
    if output.finish(code) {
        state.sessions.lock().unwrap().remove(&id);
    }
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

    fn capturing_exit_channel() -> (Channel<i32>, Arc<Mutex<Vec<i32>>>) {
        let codes = Arc::new(Mutex::new(Vec::new()));
        let captured = codes.clone();
        let exit = Channel::new(move |body| {
            if let InvokeResponseBody::Json(value) = body {
                captured
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(&value).unwrap());
            }
            Ok(())
        });
        (exit, codes)
    }

    #[test]
    fn ssh_output_hub_mutes_background_ipc_and_flushes_in_order() {
        let (data, exit, messages) = test_channels();
        let hub = SshOutputHub::new(data, exit, true);
        hub.publish(b"before".to_vec());
        hub.set_window_active(false);
        hub.publish(b"during-1".to_vec());
        hub.publish(b"during-2".to_vec());
        assert_eq!(messages.lock().unwrap().concat(), b"before");
        hub.set_window_active(true);
        assert_eq!(messages.lock().unwrap().concat(), b"beforeduring-1during-2");
    }

    #[test]
    fn ssh_output_hub_attach_replaces_sink_and_replays_backlog() {
        let (first_data, first_exit, first) = test_channels();
        let hub = SshOutputHub::new(first_data, first_exit, true);
        hub.publish(b"one".to_vec());
        let (second_data, second_exit, second) = test_channels();
        hub.attach(second_data, second_exit);
        hub.publish(b"two".to_vec());
        assert_eq!(first.lock().unwrap().concat(), b"one");
        assert_eq!(second.lock().unwrap().concat(), b"onetwo");
    }

    #[test]
    fn ssh_output_hub_backlog_is_bounded_and_marks_truncation() {
        let (data, exit, _) = test_channels();
        let hub = SshOutputHub::new(data, exit, true);
        hub.publish(vec![b'x'; BACKLOG_CAP + 17]);
        let inner = hub.0.lock().unwrap();
        assert_eq!(inner.backlog.len(), BACKLOG_CAP);
        assert!(inner.truncated);
        assert_eq!(inner.start, 17);
    }

    #[test]
    fn hidden_ssh_attach_preserves_truncation_notice_until_activation() {
        let (data, exit, _) = test_channels();
        let hub = SshOutputHub::new(data, exit, false);
        hub.publish(vec![b'x'; BACKLOG_CAP + 1]);
        let (attached_data, attached_exit, attached) = test_channels();
        hub.attach(attached_data, attached_exit);
        assert!(attached.lock().unwrap().is_empty());
        hub.set_pane_visible(true);
        let output = attached.lock().unwrap().concat();
        assert!(output
            .ends_with(b"\r\n\x1b[33m[TempoTerm: background SSH output was truncated]\x1b[0m\r\n"));
    }

    #[test]
    fn ssh_finish_after_sink_failure_replays_exit_on_attach() {
        let failed_data = Channel::new(|_| Err(tauri::Error::AssetNotFound("stale sink".into())));
        let exit = Channel::new(|_| Ok(()));
        let hub = SshOutputHub::new(failed_data, exit, true);
        hub.publish(b"before-exit".to_vec());
        hub.finish(42);

        let (attached_data, _, attached) = test_channels();
        let (attached_exit, exits) = capturing_exit_channel();
        hub.attach(attached_data, attached_exit);
        assert_eq!(attached.lock().unwrap().concat(), b"before-exit");
        assert_eq!(*exits.lock().unwrap(), vec![42]);
    }

    #[test]
    fn hidden_ssh_attach_replays_exit_on_activation() {
        let (data, exit, _) = test_channels();
        let hub = SshOutputHub::new(data, exit, false);
        hub.finish(17);

        let (attached_data, _, _) = test_channels();
        let (attached_exit, exits) = capturing_exit_channel();
        hub.attach(attached_data, attached_exit);
        assert!(exits.lock().unwrap().is_empty());

        hub.set_pane_visible(true);
        assert_eq!(*exits.lock().unwrap(), vec![17]);
    }

    #[test]
    fn hidden_ssh_completion_flushes_tail_before_exit() {
        let (data, _, messages) = test_channels();
        let (exit, exits) = capturing_exit_channel();
        let hub = SshOutputHub::new(data, exit, false);
        hub.publish(b"tail".to_vec());

        assert!(!hub.finish(29));
        assert!(messages.lock().unwrap().is_empty());
        assert!(exits.lock().unwrap().is_empty());

        assert!(hub.set_pane_visible(true));
        assert_eq!(messages.lock().unwrap().concat(), b"tail");
        assert_eq!(*exits.lock().unwrap(), vec![29]);
    }

    #[test]
    fn ssh_output_hub_requires_both_window_and_pane_visibility() {
        let (data, exit, messages) = test_channels();
        let hub = SshOutputHub::new(data, exit, false);
        hub.publish(b"hidden-pane".to_vec());
        hub.set_window_active(false);
        hub.set_pane_visible(true);
        hub.publish(b"hidden-window".to_vec());
        assert!(messages.lock().unwrap().is_empty());
        hub.set_window_active(true);
        assert_eq!(
            messages.lock().unwrap().concat(),
            b"hidden-panehidden-window"
        );
    }

    #[test]
    fn completed_ssh_session_replays_tail_and_exit_through_attach_path() {
        let state = SshState::new();
        let id = state.alloc_id();
        let (control, _receiver) = mpsc::unbounded_channel();
        let failed_data = Channel::new(|_| Err(tauri::Error::AssetNotFound("stale sink".into())));
        let failed_exit = Channel::new(|_| Err(tauri::Error::AssetNotFound("stale sink".into())));
        let hub = Arc::new(SshOutputHub::new(failed_data, failed_exit, true));
        state.sessions.lock().unwrap().insert(
            id,
            SshHandle {
                control,
                owner_label: "main".to_string(),
                output: hub.clone(),
            },
        );

        hub.publish(b"ssh-recovery-tail".to_vec());
        finish_session_inner(&state, id, &hub, 37);
        assert_eq!(
            session_count(&state),
            1,
            "failed exit delivery must retain tombstone"
        );

        let (attached_data, _, attached) = test_channels();
        let (attached_exit, exits) = capturing_exit_channel();
        attach(&state, id, "main", true, attached_data, attached_exit).unwrap();

        assert_eq!(attached.lock().unwrap().concat(), b"ssh-recovery-tail");
        assert_eq!(*exits.lock().unwrap(), vec![37]);
        assert_eq!(
            session_count(&state),
            0,
            "successful exit replay should prune tombstone"
        );
    }

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
