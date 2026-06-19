//! File system module: directory listing, file reads and search for the
//! explorer and editor.

mod dir;
mod ops;
mod search;

pub use dir::DirEntry;
pub use search::GrepMatch;

#[tauri::command]
pub fn fs_home_dir() -> String {
    dir::home_dir()
}

#[tauri::command]
pub fn fs_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    dir::read_dir(&path)
}

#[tauri::command]
pub fn fs_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_write_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_list_files(root: String, limit: Option<usize>) -> Vec<String> {
    search::list_files(&root, limit.unwrap_or(20000))
}

#[tauri::command]
pub fn fs_grep(
    root: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<GrepMatch>, String> {
    search::grep(&root, &query, limit.unwrap_or(500))
}

#[tauri::command]
pub fn fs_create_file(path: String) -> Result<(), String> {
    ops::create_file(&path)
}

#[tauri::command]
pub fn fs_create_dir(path: String) -> Result<(), String> {
    ops::create_dir(&path)
}

#[tauri::command]
pub fn fs_delete(path: String) -> Result<(), String> {
    ops::delete(&path)
}

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    ops::rename(&from, &to)
}

#[tauri::command]
pub fn fs_reveal(path: String) -> Result<(), String> {
    ops::reveal(&path)
}
