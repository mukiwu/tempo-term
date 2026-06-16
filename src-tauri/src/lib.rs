mod modules;

use modules::fonts::fonts_report;
use modules::fs::{
    fs_grep, fs_home_dir, fs_list_files, fs_read_dir, fs_read_file, fs_write_file,
};
use modules::pty::{
    pty_close, pty_close_all, pty_open, pty_resize, pty_shell_name, pty_write, PtyState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyState::new())
        .invoke_handler(tauri::generate_handler![
            pty_open,
            pty_write,
            pty_resize,
            pty_shell_name,
            pty_close,
            pty_close_all,
            fonts_report,
            fs_home_dir,
            fs_read_dir,
            fs_read_file,
            fs_write_file,
            fs_list_files,
            fs_grep
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
