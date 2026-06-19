mod modules;

use modules::fonts::fonts_report;
use modules::fs::{
    fs_create_dir, fs_create_file, fs_delete, fs_grep, fs_home_dir, fs_list_files, fs_read_dir,
    fs_read_file, fs_rename, fs_reveal, fs_write_file,
};
use modules::ai::ai_chat;
use modules::clipboard::{
    terminal_clipboard_image_paths, terminal_clipboard_paths, terminal_clipboard_text,
    terminal_prepare_clipboard_image_attachment, terminal_save_dropped_image,
};
use modules::git::{
    git_branch_checkout, git_branch_create_at, git_branch_delete, git_branches, git_cherry_pick,
    git_commit, git_commit_details, git_commit_file_diff, git_diff, git_fetch, git_graph_log, git_log,
    git_merge, git_push, git_reset, git_resolve_repo, git_revert, git_stage, git_status,
    git_tag_create, git_tag_delete, git_unstage,
};
use modules::secrets::{secrets_delete_key, secrets_has_key, secrets_set_key};
use modules::pty::{
    pty_close, pty_close_all, pty_cwd, pty_foreground_command, pty_open, pty_resize,
    pty_shell_name, pty_write, PtyState,
};
use modules::terminal_history::{
    terminal_history_clear, terminal_history_delete, terminal_history_load,
    terminal_history_prune, terminal_history_save,
};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppBuildInfo {
    os: String,
    arch: String,
}

/// OS and CPU arch the app was compiled for, for the About panel's build line.
#[tauri::command]
fn app_build_info() -> AppBuildInfo {
    AppBuildInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Persist and restore window size and position across launches. Only
        // SIZE | POSITION so it never forces the window visible early — the
        // frontend reveals it on first paint (see visible: false).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION,
                )
                .build(),
        )
        .manage(PtyState::new())
        .invoke_handler(tauri::generate_handler![
            pty_open,
            pty_write,
            pty_resize,
            pty_shell_name,
            pty_foreground_command,
            pty_cwd,
            pty_close,
            pty_close_all,
            app_build_info,
            terminal_clipboard_paths,
            terminal_clipboard_image_paths,
            terminal_clipboard_text,
            terminal_prepare_clipboard_image_attachment,
            terminal_save_dropped_image,
            fonts_report,
            fs_home_dir,
            fs_read_dir,
            fs_read_file,
            fs_write_file,
            fs_list_files,
            fs_grep,
            fs_create_file,
            fs_create_dir,
            fs_delete,
            fs_rename,
            fs_reveal,
            git_resolve_repo,
            git_status,
            git_stage,
            git_unstage,
            git_commit,
            git_log,
            git_diff,
            git_push,
            git_fetch,
            git_graph_log,
            git_branches,
            git_branch_checkout,
            git_branch_create_at,
            git_branch_delete,
            git_tag_create,
            git_tag_delete,
            git_merge,
            git_revert,
            git_cherry_pick,
            git_reset,
            git_commit_details,
            git_commit_file_diff,
            secrets_set_key,
            secrets_delete_key,
            secrets_has_key,
            ai_chat,
            terminal_history_save,
            terminal_history_load,
            terminal_history_delete,
            terminal_history_clear,
            terminal_history_prune
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
