mod modules;

use modules::fonts::fonts_report;
use modules::fs::{
    fs_create_dir, fs_create_file, fs_delete, fs_grep, fs_home_dir, fs_list_files, fs_read_dir,
    fs_read_file, fs_reveal, fs_write_file,
};
use modules::ai::ai_chat;
use modules::git::{
    git_branch_checkout, git_branch_create_at, git_branch_delete, git_branches, git_cherry_pick,
    git_commit, git_diff, git_graph_log, git_log, git_merge, git_push, git_reset, git_resolve_repo,
    git_revert, git_stage, git_status, git_tag_create, git_tag_delete, git_unstage,
};
use modules::secrets::{secrets_delete_key, secrets_has_key, secrets_set_key};
use modules::pty::{
    pty_close, pty_close_all, pty_cwd, pty_open, pty_resize, pty_shell_name, pty_write, PtyState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyState::new())
        .invoke_handler(tauri::generate_handler![
            pty_open,
            pty_write,
            pty_resize,
            pty_shell_name,
            pty_cwd,
            pty_close,
            pty_close_all,
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
            fs_reveal,
            git_resolve_repo,
            git_status,
            git_stage,
            git_unstage,
            git_commit,
            git_log,
            git_diff,
            git_push,
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
            secrets_set_key,
            secrets_delete_key,
            secrets_has_key,
            ai_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
