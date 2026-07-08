//! Pseudo-terminal module: spawns shells and bridges their IO to the frontend.

mod session;
pub mod shell;

pub use session::PtyState;

use tauri::ipc::{Channel, Response};
use tauri::State;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_open(
    app: tauri::AppHandle,
    state: State<'_, PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    suggestions: bool,
    shell_override: Option<String>,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    session::spawn(
        &state,
        cols,
        rows,
        cwd,
        suggestions,
        shell_override,
        &app,
        on_data,
        on_exit,
    )
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: u32, data: String) -> Result<(), String> {
    session::write_input(&state, id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    session::resize(&state, id, cols, rows)
}

#[tauri::command]
pub fn pty_shell_name(state: State<'_, PtyState>, id: u32) -> Result<String, String> {
    session::shell_name(&state, id)
}

// Async so Tauri runs the blocking `ps` lookup on its worker pool rather than the
// main GUI thread (same reasoning as sysmon/ports). This runs every ~1.2s per pane,
// so a slow `ps` on the GUI thread would directly stall the UI.
#[tauri::command]
pub async fn pty_foreground_command(
    state: State<'_, PtyState>,
    id: u32,
) -> Result<Option<String>, String> {
    session::foreground_command(&state, id)
}

// Async so the blocking `lsof` cwd lookup runs off the main GUI thread (see above).
#[tauri::command]
pub async fn pty_cwd(state: State<'_, PtyState>, id: u32) -> Result<Option<String>, String> {
    session::cwd(&state, id)
}

#[tauri::command]
pub fn pty_close(state: State<'_, PtyState>, id: u32) {
    session::close(&state, id);
}

#[tauri::command]
pub fn pty_close_all(state: State<'_, PtyState>) {
    session::close_all(&state);
}
