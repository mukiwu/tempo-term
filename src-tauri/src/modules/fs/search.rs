//! File walking and content search for the explorer's fuzzy finder and grep.

use grep_regex::RegexMatcher;
use grep_searcher::sinks::UTF8;
use grep_searcher::Searcher;
use ignore::WalkBuilder;
use serde::Serialize;

/// Walk `root` honouring .gitignore, returning file paths up to `limit`.
pub fn list_files(root: &str, limit: usize) -> Vec<String> {
    let mut files = Vec::new();
    for result in WalkBuilder::new(root).git_ignore(true).hidden(false).build() {
        if files.len() >= limit {
            break;
        }
        if let Ok(entry) = result {
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                files.push(entry.path().to_string_lossy().into_owned());
            }
        }
    }
    files
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GrepMatch {
    pub path: String,
    pub line_number: u64,
    pub line: String,
}

/// Grep `query` (treated as a literal) across files under `root`, honouring
/// .gitignore, returning up to `limit` matches.
pub fn grep(root: &str, query: &str, limit: usize) -> Result<Vec<GrepMatch>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let matcher = RegexMatcher::new(&regex_escape(query)).map_err(|e| e.to_string())?;
    let mut matches = Vec::new();

    for result in WalkBuilder::new(root).git_ignore(true).hidden(false).build() {
        if matches.len() >= limit {
            break;
        }
        let Ok(entry) = result else { continue };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = entry.path().to_string_lossy().into_owned();
        let mut searcher = Searcher::new();
        let _ = searcher.search_path(
            &matcher,
            entry.path(),
            UTF8(|line_number, line| {
                if matches.len() < limit {
                    matches.push(GrepMatch {
                        path: path.clone(),
                        line_number,
                        line: line.trim_end().to_string(),
                    });
                }
                Ok(matches.len() < limit)
            }),
        );
    }

    Ok(matches)
}

/// Escape regex metacharacters so the query is matched literally.
fn regex_escape(query: &str) -> String {
    let mut escaped = String::with_capacity(query.len());
    for ch in query.chars() {
        if "\\.+*?()|[]{}^$".contains(ch) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_regex_metacharacters() {
        assert_eq!(regex_escape("a.b*c"), "a\\.b\\*c");
        assert_eq!(regex_escape("plain"), "plain");
    }

    #[test]
    fn lists_files_and_respects_gitignore() {
        let root = env!("CARGO_MANIFEST_DIR");
        let files = list_files(root, 5000);
        assert!(files.iter().any(|f| f.ends_with("Cargo.toml")));
        // target/ is gitignored, so its artifacts must not appear.
        assert!(!files.iter().any(|f| f.contains("/target/")));
    }

    #[test]
    fn grep_finds_a_known_string() {
        let root = env!("CARGO_MANIFEST_DIR");
        let matches = grep(root, "PtyState", 50).expect("grep should run");
        assert!(matches.iter().any(|m| m.path.ends_with(".rs")));
    }

    #[test]
    fn grep_returns_empty_for_blank_query() {
        let root = env!("CARGO_MANIFEST_DIR");
        assert!(grep(root, "", 50).unwrap().is_empty());
    }
}
