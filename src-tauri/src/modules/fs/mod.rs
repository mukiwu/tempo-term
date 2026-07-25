//! File system module: directory listing, file reads and search for the
//! explorer and editor.

use std::io::Read;

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

/// Ceiling for `fs_read_file`: bigger than any text file the editor should
/// open, and a bound against pulling a multi-GB log into memory in one call.
const MAX_READ_FILE_BYTES: u64 = 10 * 1024 * 1024;

/// True for a path that names a DOS device (`NUL`, `CON`, `COM1`, also with
/// an extension like `nul.txt`). On Windows `FileType::is_file` is merely
/// "not a directory, not a symlink", so devices pass the regular-file check;
/// reading one can block forever (e.g. a serial port). Pure string check so
/// the Windows behaviour is unit-testable from any platform.
fn is_dos_device_path(path: &str) -> bool {
    let name = path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .trim_end_matches([' ', '.']);
    let stem = name.split('.').next().unwrap_or(name);
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || (upper.len() == 4
            && (upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper[3..].chars().all(|c| c.is_ascii_digit()))
}

/// Read a file after metadata checks: only regular files and only up to
/// `max_bytes`, enforced on the bytes actually read (a live log can outgrow
/// its stat size). On unix `is_file` refuses devices, FIFOs and directories;
/// on Windows it only refuses directories, so DOS device names are screened
/// separately. A FIFO swapped in between stat and open can still block the
/// read — accepted for a local single-user app.
fn read_file_capped(path: &str, max_bytes: u64) -> Result<String, String> {
    if cfg!(windows) && is_dos_device_path(path) {
        return Err(format!("not a regular file: {path}"));
    }
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err(format!("not a regular file: {path}"));
    }
    if meta.len() > max_bytes {
        return Err(format!(
            "file too large to open ({} bytes, limit {max_bytes}): {path}",
            meta.len()
        ));
    }
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    std::io::Read::take(file, max_bytes + 1)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    if buf.len() as u64 > max_bytes {
        return Err(format!(
            "file too large to open (over {max_bytes} bytes): {path}"
        ));
    }
    String::from_utf8(buf).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_read_file(path: String) -> Result<String, String> {
    // Off the main thread: a slow disk or network mount must not freeze the UI.
    tauri::async_runtime::spawn_blocking(move || read_file_capped(&path, MAX_READ_FILE_BYTES))
        .await
        .map_err(|e| e.to_string())?
}

/// Metadata-only probe: true when `path` names an openable file (a regular
/// file on unix; on Windows anything that is not a directory or DOS device).
/// Terminal links use this instead of reading the whole file just to decide
/// whether a click should open an editor pane. Async for the same reason as
/// `fs_read_file`: the path is attacker-choosable terminal output, and a
/// stat on a dead network mount must not freeze the UI.
fn is_openable_file(path: &str) -> bool {
    if cfg!(windows) && is_dos_device_path(path) {
        return false;
    }
    std::fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

#[tauri::command]
pub async fn fs_is_file(path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || is_openable_file(&path))
        .await
        .map_err(|e| e.to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("tempoterm-fs-test-{}-{}", std::process::id(), name));
        dir
    }

    #[test]
    fn reads_a_regular_file_within_the_cap() {
        let path = temp_path("small.txt");
        std::fs::write(&path, "hello").unwrap();

        assert_eq!(
            read_file_capped(&path.to_string_lossy(), 1024),
            Ok("hello".to_string())
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn refuses_a_file_over_the_cap() {
        let path = temp_path("big.txt");
        std::fs::write(&path, "0123456789").unwrap();

        let err = read_file_capped(&path.to_string_lossy(), 4).unwrap_err();
        assert!(err.contains("too large"), "unexpected error: {err}");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn refuses_a_non_regular_file() {
        let err = read_file_capped(&std::env::temp_dir().to_string_lossy(), u64::MAX).unwrap_err();
        assert!(err.contains("not a regular file"), "unexpected error: {err}");
    }

    #[test]
    fn probe_is_only_true_for_openable_files() {
        let path = temp_path("probe.txt");
        std::fs::write(&path, "x").unwrap();

        assert!(is_openable_file(&path.to_string_lossy()));
        assert!(!is_openable_file(&std::env::temp_dir().to_string_lossy()));
        assert!(!is_openable_file(&temp_path("missing.txt").to_string_lossy()));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn detects_dos_device_paths_in_any_spelling() {
        assert!(is_dos_device_path("NUL"));
        assert!(is_dos_device_path("nul.txt"));
        assert!(is_dos_device_path(r"C:\work\con.log"));
        assert!(is_dos_device_path("/tmp/COM1"));
        assert!(is_dos_device_path("LPT9.dat"));
        assert!(is_dos_device_path("NUL  ")); // trailing spaces are stripped by Win32
        assert!(is_dos_device_path("conout$"));

        assert!(!is_dos_device_path("null.txt"));
        assert!(!is_dos_device_path("console.log"));
        assert!(!is_dos_device_path("COM10.txt"));
        assert!(!is_dos_device_path("compare.rs"));
        assert!(!is_dos_device_path(r"C:\nul\readme.md")); // device name as a directory, not the file
    }
}
