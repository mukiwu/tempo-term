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
    ReadFile {
        path: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
    WriteFile {
        path: String,
        contents: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    CreateFile {
        path: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    CreateDir {
        path: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Delete {
        path: String,
        is_dir: bool,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Rename {
        from: String,
        to: String,
        reply: oneshot::Sender<Result<(), String>>,
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
            SftpControl::ReadFile { path, reply } => {
                let _ = reply.send(read_file(&sftp, &path).await);
            }
            SftpControl::WriteFile {
                path,
                contents,
                reply,
            } => {
                let _ = reply.send(write_file(&sftp, &path, &contents).await);
            }
            SftpControl::CreateFile { path, reply } => {
                let _ = reply.send(create_file(&sftp, &path).await);
            }
            SftpControl::CreateDir { path, reply } => {
                let _ = reply.send(
                    sftp.create_dir(path).await.map_err(|e| e.to_string()),
                );
            }
            SftpControl::Delete { path, is_dir, reply } => {
                let _ = reply.send(delete(&sftp, &path, is_dir).await);
            }
            SftpControl::Rename { from, to, reply } => {
                let _ = reply.send(
                    sftp.rename(from, to).await.map_err(|e| e.to_string()),
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
            SftpControl::ReadFile { reply, .. } => {
                let _ = reply.send(Err(reason.clone()));
            }
            SftpControl::WriteFile { reply, .. } => {
                let _ = reply.send(Err(reason.clone()));
            }
            SftpControl::CreateFile { reply, .. }
            | SftpControl::CreateDir { reply, .. }
            | SftpControl::Delete { reply, .. }
            | SftpControl::Rename { reply, .. } => {
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

async fn read_file(sftp: &SftpSession, path: &str) -> Result<String, String> {
    use tokio::io::AsyncReadExt;
    let mut file = sftp.open(path.to_string()).await.map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).await.map_err(|e| e.to_string())?;
    String::from_utf8(buf).map_err(|_| "file is not valid UTF-8".to_string())
}

async fn write_file(sftp: &SftpSession, path: &str, contents: &str) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    use tokio::io::AsyncWriteExt;
    let mut file = sftp
        .open_with_flags(
            path.to_string(),
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
        )
        .await
        .map_err(|e| e.to_string())?;
    file.write_all(contents.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    file.shutdown().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Create an empty file, failing when it already exists — the same contract as
/// the local `fs/ops.rs::create_file`, via SFTP's EXCLUDE open flag.
async fn create_file(sftp: &SftpSession, path: &str) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    use tokio::io::AsyncWriteExt;
    let mut file = sftp
        .open_with_flags(
            path.to_string(),
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::EXCLUDE,
        )
        .await
        .map_err(|e| e.to_string())?;
    file.shutdown().await.map_err(|e| e.to_string())
}

/// SFTP splits delete into two calls by entry kind; the caller passes the kind
/// it already knows from the DirEntry it is deleting.
async fn delete(sftp: &SftpSession, path: &str, is_dir: bool) -> Result<(), String> {
    if is_dir {
        sftp.remove_dir(path.to_string()).await.map_err(|e| e.to_string())
    } else {
        sftp.remove_file(path.to_string()).await.map_err(|e| e.to_string())
    }
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

pub async fn read_file_cmd(
    state: &State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<String, String> {
    let (tx, rx) = oneshot::channel();
    send(state, id, SftpControl::ReadFile { path, reply: tx })?;
    rx.await.map_err(|_| "sftp session closed".to_string())?
}

pub async fn write_file_cmd(
    state: &State<'_, SftpState>,
    id: u32,
    path: String,
    contents: String,
) -> Result<(), String> {
    let (tx, rx) = oneshot::channel();
    send(
        state,
        id,
        SftpControl::WriteFile {
            path,
            contents,
            reply: tx,
        },
    )?;
    rx.await.map_err(|_| "sftp session closed".to_string())?
}

pub async fn create_file_cmd(
    state: &State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<(), String> {
    let (tx, rx) = oneshot::channel();
    send(state, id, SftpControl::CreateFile { path, reply: tx })?;
    rx.await.map_err(|_| "sftp session closed".to_string())?
}

pub async fn create_dir_cmd(
    state: &State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<(), String> {
    let (tx, rx) = oneshot::channel();
    send(state, id, SftpControl::CreateDir { path, reply: tx })?;
    rx.await.map_err(|_| "sftp session closed".to_string())?
}

pub async fn delete_cmd(
    state: &State<'_, SftpState>,
    id: u32,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let (tx, rx) = oneshot::channel();
    send(state, id, SftpControl::Delete { path, is_dir, reply: tx })?;
    rx.await.map_err(|_| "sftp session closed".to_string())?
}

pub async fn rename_cmd(
    state: &State<'_, SftpState>,
    id: u32,
    from: String,
    to: String,
) -> Result<(), String> {
    let (tx, rx) = oneshot::channel();
    send(state, id, SftpControl::Rename { from, to, reply: tx })?;
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
