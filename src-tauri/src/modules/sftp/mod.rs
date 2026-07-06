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
pub async fn sftp_read_file(
    state: State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<String, String> {
    session::read_file_cmd(&state, id, path).await
}

#[tauri::command]
pub async fn sftp_write_file(
    state: State<'_, SftpState>,
    id: u32,
    path: String,
    contents: String,
) -> Result<(), String> {
    session::write_file_cmd(&state, id, path, contents).await
}

#[tauri::command]
pub async fn sftp_create_file(
    state: State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<(), String> {
    session::create_file_cmd(&state, id, path).await
}

#[tauri::command]
pub async fn sftp_create_dir(
    state: State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<(), String> {
    session::create_dir_cmd(&state, id, path).await
}

#[tauri::command]
pub async fn sftp_delete(
    state: State<'_, SftpState>,
    id: u32,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    session::delete_cmd(&state, id, path, is_dir).await
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, SftpState>,
    id: u32,
    from: String,
    to: String,
) -> Result<(), String> {
    session::rename_cmd(&state, id, from, to).await
}

#[tauri::command]
pub fn sftp_close(state: State<'_, SftpState>, id: u32) {
    session::close(&state, id)
}
