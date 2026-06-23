mod client;
mod known_hosts;
mod prompt;
mod session;

pub use prompt::PromptReply;
pub use session::SshState;

use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, State};

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
