mod modules;

use tauri::Manager;

use modules::fonts::fonts_report;
use modules::fs::{
    fs_create_dir, fs_create_file, fs_delete, fs_grep, fs_home_dir, fs_list_files, fs_read_dir,
    fs_read_file, fs_rename, fs_reveal, fs_write_file,
};
use modules::ai::ai_chat;
use modules::claude_progress::{
    claude_progress_unwatch, claude_progress_watch, claude_session_title, ClaudeProgressState,
};
use modules::codex_progress::{codex_session_title, CodexProgressState};
use modules::claude_status_hook::{claude_status_hook_install, claude_status_hook_uninstall};
use modules::codex_status_hook::{codex_status_hook_install, codex_status_hook_uninstall};
use modules::notes::{notes_unwatch, notes_watch, NotesWatchState};
use modules::clipboard::{
    terminal_clipboard_image_paths, terminal_clipboard_paths, terminal_clipboard_text,
    terminal_prepare_clipboard_image_attachment, terminal_save_dropped_image,
};
use modules::git::{
    git_branch_checkout, git_branch_checkout_track, git_branch_create_at, git_branch_delete,
    git_branches, git_cherry_pick, git_commit, git_commit_details, git_commit_file_diff, git_diff,
    git_fetch, git_graph_log, git_log, git_merge, git_pull, git_push, git_push_delete, git_rebase,
    git_reset, git_resolve_repo, git_revert, git_stage, git_status, git_tag_create, git_tag_delete,
    git_unstage, git_worktree_info,
};
use modules::pr::{gh_available, pr_via_api, pr_via_gh};
use modules::secrets::{
    secrets_delete_key, secrets_has_key, secrets_set_key, ssh_secret_delete, ssh_secret_set,
};
use modules::pty::{
    pty_close, pty_close_all, pty_cwd, pty_foreground_command, pty_open, pty_resize,
    pty_shell_name, pty_write, PtyState,
};
use modules::ssh::{
    ssh_close, ssh_forward_start, ssh_forward_stop, ssh_open, ssh_prompt_reply, ssh_resize,
    ssh_write, SshState,
};
use modules::sftp::{
    sftp_close, sftp_home, sftp_read_dir, sftp_read_file, sftp_start, sftp_write_file, SftpState,
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
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .manage(PtyState::new())
        .manage(SshState::new())
        .manage(SftpState::new())
        .manage(ClaudeProgressState::new())
        .manage(CodexProgressState::new())
        .manage(NotesWatchState::new())
        .setup(|app| {
            // window-state restores the last size/position, but it can persist a
            // corrupt tiny / off-screen value (observed 360x240 at a negative
            // position) and restores it bypassing the configured minimums. Clamp
            // anything below the minimums back to the default, centered, so the
            // window can never shrink to nothing or get lost off-screen.
            if let Some(window) = app.get_webview_window("main") {
                if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
                    let logical = size.to_logical::<f64>(scale);
                    if logical.width < 720.0 || logical.height < 480.0 {
                        let _ = window.set_size(tauri::LogicalSize::new(1200.0, 800.0));
                        let _ = window.center();
                    }
                }
            }
            // Resolve the encrypted secrets file once; create the data dir so
            // the first write succeeds on a fresh install.
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&dir);
                modules::secrets::init_store_path(dir.join("secrets.enc"));
            }
            modules::menu::init(app)?;
            Ok(())
        })
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
            git_worktree_info,
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
            git_rebase,
            git_branch_checkout_track,
            git_pull,
            git_push_delete,
            git_commit_details,
            git_commit_file_diff,
            secrets_set_key,
            secrets_delete_key,
            secrets_has_key,
            gh_available,
            pr_via_gh,
            pr_via_api,
            ai_chat,
            terminal_history_save,
            terminal_history_load,
            terminal_history_delete,
            terminal_history_clear,
            terminal_history_prune,
            claude_progress_watch,
            claude_progress_unwatch,
            claude_session_title,
            codex_session_title,
            claude_status_hook_install,
            claude_status_hook_uninstall,
            codex_status_hook_install,
            codex_status_hook_uninstall,
            notes_watch,
            notes_unwatch,
            ssh_open,
            ssh_write,
            ssh_resize,
            ssh_close,
            ssh_prompt_reply,
            ssh_forward_start,
            ssh_forward_stop,
            sftp_start,
            sftp_home,
            sftp_read_dir,
            sftp_read_file,
            sftp_write_file,
            sftp_close,
            ssh_secret_set,
            ssh_secret_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
