//! SFTP session manager. Each session owns its own dedicated SSH connection
//! (separate from the interactive shell), driven on one worker thread with a
//! current-thread tokio runtime, exactly like the `ssh` and `pty` modules.
//! Control messages carry a `oneshot` so each command awaits its own reply.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, State};
use tokio::sync::{mpsc, oneshot};

use russh_sftp::client::SftpSession;

use crate::modules::ssh::{
    connect_authenticated, AuthedConnectArgs, PromptRegistryHandle, SshState,
};

/// One remote directory entry, shaped to match the frontend `DirEntry`.
#[derive(serde::Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// A control message from a Tauri command thread to a session's worker.
pub enum SftpControl {
    ReadDir {
        path: String,
        reply: oneshot::Sender<Result<Vec<SftpEntry>, String>>,
    },
    Home {
        reply: oneshot::Sender<Result<String, String>>,
    },
    Close,
}

struct SftpHandle {
    control: mpsc::UnboundedSender<SftpControl>,
}

/// Inbound connection parameters, mirroring `SshOpenRequest` minus the
/// terminal-only fields. The frontend supplies these from `connectionsStore`.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpStartRequest {
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_method: String,
    pub key_path: Option<String>,
}

/// Holds every live SFTP session. Ids start high so a session's interactive
/// prompt id (`{id}-password`) never collides with a shell session's, since
/// both share the ssh PromptRegistry.
pub struct SftpState {
    sessions: Mutex<HashMap<u32, SftpHandle>>,
    next_id: AtomicU32,
}

impl SftpState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1_000_000),
        }
    }

    fn alloc_id(&self) -> u32 {
        self.next_id.fetch_add(1, Ordering::Relaxed) + 1
    }
}

pub fn start(
    app: &AppHandle,
    window_label: String,
    ssh_state: &State<'_, SshState>,
    state: &State<'_, SftpState>,
    req: SftpStartRequest,
) -> Result<u32, String> {
    let id = state.alloc_id();
    let (tx, rx) = mpsc::unbounded_channel::<SftpControl>();
    state
        .sessions
        .lock()
        .unwrap()
        .insert(id, SftpHandle { control: tx });

    let registry = ssh_state.registry.clone();
    let app = app.clone();
    let known_hosts_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("ssh_known_hosts");

    std::thread::spawn(move || {
        let cleanup_app = app.clone();
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(_) => {
                remove_session(&cleanup_app, id);
                return;
            }
        };
        rt.block_on(run(app, window_label, registry, known_hosts_path, req, id, rx));
        remove_session(&cleanup_app, id);
    });

    Ok(id)
}

async fn run(
    app: AppHandle,
    window_label: String,
    registry: Arc<PromptRegistryHandle>,
    known_hosts_path: std::path::PathBuf,
    req: SftpStartRequest,
    session_id: u32,
    rx: mpsc::UnboundedReceiver<SftpControl>,
) {
    let handle = match connect_authenticated(AuthedConnectArgs {
        app,
        window_label,
        registry,
        known_hosts_path,
        host: req.host,
        port: req.port,
        user: req.user,
        auth_method: req.auth_method,
        key_path: req.key_path,
        connection_id: req.connection_id,
        session_id,
    })
    .await
    {
        Ok(handle) => handle,
        Err(e) => return fail(rx, e).await,
    };

    let channel = match handle.channel_open_session().await {
        Ok(c) => c,
        Err(e) => return fail(rx, format!("failed to open SFTP channel: {e}")).await,
    };
    if let Err(e) = channel.request_subsystem(true, "sftp").await {
        return fail(rx, format!("failed to start SFTP subsystem: {e}")).await;
    }
    let sftp = match SftpSession::new(channel.into_stream()).await {
        Ok(s) => s,
        Err(e) => return fail(rx, format!("failed to initialize SFTP: {e}")).await,
    };

    let mut rx = rx;
    while let Some(msg) = rx.recv().await {
        match msg {
            SftpControl::ReadDir { path, reply } => {
                let _ = reply.send(read_dir(&sftp, &path).await);
            }
            SftpControl::Home { reply } => {
                let _ = reply.send(
                    sftp.canonicalize(".".to_string())
                        .await
                        .map_err(|e| e.to_string()),
                );
            }
            SftpControl::Close => break,
        }
    }
}

/// After a connect/auth failure, answer every queued and future request with the
/// same readable error until the channel closes, so callers see why.
async fn fail(mut rx: mpsc::UnboundedReceiver<SftpControl>, reason: String) {
    while let Some(msg) = rx.recv().await {
        match msg {
            SftpControl::ReadDir { reply, .. } => {
                let _ = reply.send(Err(reason.clone()));
            }
            SftpControl::Home { reply } => {
                let _ = reply.send(Err(reason.clone()));
            }
            SftpControl::Close => break,
        }
    }
}

async fn read_dir(sftp: &SftpSession, path: &str) -> Result<Vec<SftpEntry>, String> {
    let canonical = sftp
        .canonicalize(path.to_string())
        .await
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in sftp
        .read_dir(canonical.clone())
        .await
        .map_err(|e| e.to_string())?
    {
        let md = entry.metadata();
        let name = entry.file_name();
        let full = if canonical.ends_with('/') {
            format!("{canonical}{name}")
        } else {
            format!("{canonical}/{name}")
        };
        out.push(SftpEntry {
            name,
            path: full,
            is_dir: md.file_type().is_dir(),
            size: md.size.unwrap_or(0),
        });
    }
    Ok(out)
}

fn send(state: &State<'_, SftpState>, id: u32, msg: SftpControl) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let handle = sessions
        .get(&id)
        .ok_or_else(|| format!("sftp session {id} not found"))?;
    handle
        .control
        .send(msg)
        .map_err(|_| "sftp session closed".to_string())
}

pub async fn home(state: &State<'_, SftpState>, id: u32) -> Result<String, String> {
    let (tx, rx) = oneshot::channel();
    send(state, id, SftpControl::Home { reply: tx })?;
    rx.await.map_err(|_| "sftp session closed".to_string())?
}

pub async fn read_dir_cmd(
    state: &State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<Vec<SftpEntry>, String> {
    let (tx, rx) = oneshot::channel();
    send(state, id, SftpControl::ReadDir { path, reply: tx })?;
    rx.await.map_err(|_| "sftp session closed".to_string())?
}

pub fn close(state: &State<'_, SftpState>, id: u32) {
    let _ = send(state, id, SftpControl::Close);
    state.sessions.lock().unwrap().remove(&id);
}

fn remove_session(app: &AppHandle, id: u32) {
    let state = app.state::<SftpState>();
    state.sessions.lock().unwrap().remove(&id);
}
