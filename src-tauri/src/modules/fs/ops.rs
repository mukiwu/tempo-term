//! File system mutations for the explorer's context menu: create an empty file
//! or directory, move an entry to the OS trash, and reveal it in the native
//! file manager.

use std::path::Path;
use std::process::Command;

/// Create an empty file, failing if anything already exists at `path` so the
/// caller never clobbers an existing file.
pub fn create_file(path: &str) -> Result<(), String> {
    if Path::new(path).exists() {
        return Err(format!("{path} already exists"));
    }
    std::fs::write(path, "").map_err(|e| e.to_string())
}

/// Create a directory, failing if anything already exists at `path`. Parent
/// directories are expected to exist already (the tree only creates inside a
/// folder it just listed).
pub fn create_dir(path: &str) -> Result<(), String> {
    if Path::new(path).exists() {
        return Err(format!("{path} already exists"));
    }
    std::fs::create_dir(path).map_err(|e| e.to_string())
}

/// Move a file or directory to the OS trash / recycle bin. Never permanently
/// removes anything, so a mis-click stays recoverable.
pub fn delete(path: &str) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

/// Rename or move a file or directory from `from` to `to`, failing if a
/// different entry already exists at `to` so a rename never clobbers another
/// note. A case-only rename on a case-insensitive filesystem (where `to`
/// resolves to the same entry as `from`, e.g. `draft.md` -> `Draft.md`) is
/// allowed.
pub fn rename(from: &str, to: &str) -> Result<(), String> {
    if Path::new(to).exists() {
        let from_canonical = std::fs::canonicalize(from).ok();
        let to_canonical = std::fs::canonicalize(to).ok();
        let same_entry = from_canonical.is_some() && from_canonical == to_canonical;
        if !same_entry {
            return Err(format!("{to} already exists"));
        }
    }
    std::fs::rename(from, to).map_err(|e| e.to_string())
}

/// Reveal an entry in the platform's file manager, selecting it where possible:
/// Finder on macOS, Explorer on Windows, and a best-effort open of the parent
/// directory elsewhere.
pub fn reveal(path: &str) -> Result<(), String> {
    // Canonicalize first: this confirms the entry exists and yields an absolute
    // path, which can't be mistaken for a command-line flag. The explicit
    // leading-dash check is belt-and-braces against argument injection.
    let canonical = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    if canonical.to_string_lossy().starts_with('-') {
        return Err("invalid path".into());
    }

    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg("-R").arg(&canonical).status()
    } else if cfg!(target_os = "windows") {
        Command::new("explorer")
            .arg(format!("/select,{}", canonical.display()))
            .status()
    } else {
        // Linux and the rest: there is no portable "select", so open the parent
        // directory (or the path itself when it has no parent).
        let target = canonical.parent().unwrap_or(canonical.as_path());
        Command::new("xdg-open").arg(target).status()
    };

    match status {
        Ok(_) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "tempoterm-ops-test-{}-{}",
            std::process::id(),
            name
        ));
        dir
    }

    #[test]
    fn create_file_makes_an_empty_file() {
        let path = temp_path("new-file.txt");
        let _ = std::fs::remove_file(&path);
        let path_str = path.to_string_lossy().into_owned();

        create_file(&path_str).expect("should create the file");
        assert!(path.exists());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn create_file_refuses_to_overwrite() {
        let path = temp_path("existing-file.txt");
        std::fs::write(&path, "keep me").unwrap();
        let path_str = path.to_string_lossy().into_owned();

        let result = create_file(&path_str);
        assert!(result.is_err());
        // The original contents must be untouched.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "keep me");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn create_dir_makes_a_directory() {
        let path = temp_path("new-dir");
        let _ = std::fs::remove_dir_all(&path);
        let path_str = path.to_string_lossy().into_owned();

        create_dir(&path_str).expect("should create the directory");
        assert!(path.is_dir());

        let _ = std::fs::remove_dir_all(&path);
    }

    #[test]
    fn create_dir_refuses_when_it_exists() {
        let path = temp_path("existing-dir");
        std::fs::create_dir_all(&path).unwrap();
        let path_str = path.to_string_lossy().into_owned();

        let result = create_dir(&path_str);
        assert!(result.is_err());

        let _ = std::fs::remove_dir_all(&path);
    }

    #[test]
    fn reveal_rejects_a_nonexistent_path() {
        // canonicalize fails for a path that doesn't exist, so reveal never
        // shells out with attacker-influenced, unvalidated input.
        let result = reveal("/no/such/tempoterm/path/-flag.txt");
        assert!(result.is_err());
    }
}
