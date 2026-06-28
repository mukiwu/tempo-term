pub(crate) mod client;
mod forward;
mod known_hosts;
mod prompt;
mod session;

pub use prompt::PromptReply;
pub use session::SshState;
pub(crate) use client::{connect_authenticated, AuthedConnectArgs, PromptRegistryHandle};

use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, State};

/// Frontend-facing port-forward spec, deserialized from camelCase JSON.
/// Mirrors `forward::ForwardSpec` but lives here so Tauri commands can
/// accept it directly without exposing `ForwardSpec`'s internal type.
#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ForwardSpecInput {
    pub id: String,
    pub bind_host: String,
    pub local_port: u16,
    pub dest_host: String,
    pub dest_port: u16,
}

impl From<&ForwardSpecInput> for forward::ForwardSpec {
    fn from(input: &ForwardSpecInput) -> Self {
        forward::ForwardSpec {
            id: input.id.clone(),
            bind_host: input.bind_host.clone(),
            local_port: input.local_port,
            dest_host: input.dest_host.clone(),
            dest_port: input.dest_port,
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshOpenRequest {
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_method: String, // "password" | "keyFile" | "agent"
    pub key_path: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Port forwards to set up after the session authenticates.
    /// Defaults to an empty list when the field is absent.
    #[serde(default)]
    pub forwards: Vec<ForwardSpecInput>,
    /// Tee this session's output to a per-session log file. Defaults to false
    /// when the frontend omits it.
    #[serde(default)]
    pub log_enabled: bool,
}

#[tauri::command]
pub fn ssh_open(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, SshState>,
    req: SshOpenRequest,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    // Capture the label of the window that initiated this connection so the
    // interactive `ssh-prompt` event is delivered only there, not broadcast to
    // every open window.
    let window_label = window.label().to_string();
    session::open(&app, window_label, &state, req, on_data, on_exit)
}

#[tauri::command]
pub fn ssh_write(state: State<'_, SshState>, id: u32, data: String) -> Result<(), String> {
    session::write_input(&state, id, data.into_bytes())
}

#[tauri::command]
pub fn ssh_resize(
    state: State<'_, SshState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    session::resize(&state, id, cols, rows)
}

#[tauri::command]
pub fn ssh_close(state: State<'_, SshState>, id: u32) {
    session::close(&state, id);
}

#[tauri::command]
pub fn ssh_prompt_reply(
    state: State<'_, SshState>,
    id: String,
    reply: PromptReply,
) -> Result<(), String> {
    state.resolve_prompt(&id, reply);
    Ok(())
}

#[tauri::command]
pub fn ssh_forward_start(
    state: State<'_, SshState>,
    id: u32,
    forward: ForwardSpecInput,
) -> Result<(), String> {
    session::forward_start(&state, id, forward)
}

#[tauri::command]
pub fn ssh_forward_stop(
    state: State<'_, SshState>,
    id: u32,
    forward_id: String,
) -> Result<(), String> {
    session::forward_stop(&state, id, forward_id)
}
