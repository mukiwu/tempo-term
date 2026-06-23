mod session;

pub use session::SftpState;
use session::{SftpEntry, SftpStartRequest};

use tauri::{AppHandle, State};

use crate::modules::ssh::SshState;

#[tauri::command]
pub fn sftp_start(
    app: AppHandle,
    window: tauri::WebviewWindow,
    ssh_state: State<'_, SshState>,
    state: State<'_, SftpState>,
    req: SftpStartRequest,
) -> Result<u32, String> {
    session::start(&app, window.label().to_string(), &ssh_state, &state, req)
}

#[tauri::command]
pub async fn sftp_home(state: State<'_, SftpState>, id: u32) -> Result<String, String> {
    session::home(&state, id).await
}

#[tauri::command]
pub async fn sftp_read_dir(
    state: State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<Vec<SftpEntry>, String> {
    session::read_dir_cmd(&state, id, path).await
}

#[tauri::command]
pub fn sftp_close(state: State<'_, SftpState>, id: u32) {
    session::close(&state, id)
}
