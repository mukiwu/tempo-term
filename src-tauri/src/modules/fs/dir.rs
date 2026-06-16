//! Directory listing for the file explorer.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// Directories first, then case-insensitive name order, the way a file tree
/// usually presents entries.
pub fn sort_entries(mut entries: Vec<DirEntry>) -> Vec<DirEntry> {
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries
}

pub fn read_dir(path: &str) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    Ok(sort_entries(entries))
}

pub fn home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| {
            Path::new("/")
                .to_string_lossy()
                .into_owned()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, is_dir: bool) -> DirEntry {
        DirEntry {
            name: name.to_string(),
            path: format!("/x/{name}"),
            is_dir,
            size: 0,
        }
    }

    #[test]
    fn sorts_directories_before_files() {
        let sorted = sort_entries(vec![
            entry("zeta.txt", false),
            entry("alpha", true),
            entry("beta.txt", false),
            entry("gamma", true),
        ]);
        let names: Vec<&str> = sorted.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "gamma", "beta.txt", "zeta.txt"]);
    }

    #[test]
    fn sorts_case_insensitively_within_a_group() {
        let sorted = sort_entries(vec![
            entry("README.md", false),
            entry("apple.txt", false),
            entry("Banana.txt", false),
        ]);
        let names: Vec<&str> = sorted.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["apple.txt", "Banana.txt", "README.md"]);
    }

    #[test]
    fn reads_a_real_directory() {
        let dir = env!("CARGO_MANIFEST_DIR");
        let entries = read_dir(dir).expect("should read the crate directory");
        assert!(entries.iter().any(|e| e.name == "Cargo.toml" && !e.is_dir));
        assert!(entries.iter().any(|e| e.name == "src" && e.is_dir));
    }
}
