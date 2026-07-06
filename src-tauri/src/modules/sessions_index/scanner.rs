//! Discovers session source files across the three agent roots (Claude Code,
//! Codex, Antigravity CLI) without ever reading their contents. A missing
//! root (an agent the user has never run) contributes nothing and is never
//! an error.
//!
//! Each agent's layout gets its own, deliberately narrow, discovery rule:
//! - Claude: only top-level `*.jsonl` files inside each project subdir of
//!   `projects/`. Never recurses into a `<session-id>/` companion directory.
//! - Codex: `rollout-*.jsonl` files nested up to three directories deep under
//!   `sessions/` (the `YYYY/MM/DD` layout), plus flat, unfiltered `*.jsonl`
//!   files directly under `archived_sessions/`.
//! - Antigravity: only `*.db` files directly under `conversations/`; SQLite's
//!   `-wal`/`-shm` companions and `.db-journal` are excluded because their
//!   file extension is never exactly `db`.

use std::path::{Path, PathBuf};

/// One discovered session source file, tagged with the agent that owns it.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionFile {
    /// "claude" | "codex" | "antigravity"
    pub agent: &'static str,
    pub path: PathBuf,
}

/// How many nested directories under Codex's `sessions/` root are walked
/// (the `YYYY/MM/DD` layout); a `rollout-*.jsonl` file one level deeper than
/// this is silently excluded rather than found.
const CODEX_SESSIONS_MAX_NESTED_DIRS: u32 = 3;

/// Resolved (agent, root dir) pairs, honoring env overrides passed in as
/// plain values rather than read from `std::env` directly, so callers (tests
/// especially) can exercise every override combination without mutating
/// process env. Use `roots_from_env` at real call sites.
pub fn roots(
    home: &Path,
    claude_config_dir: Option<&str>,
    codex_home: Option<&str>,
    antigravity_cli_dir: Option<&str>,
) -> Vec<(&'static str, PathBuf)> {
    let claude_base = crate::modules::claude_progress::config_base_dir(home, claude_config_dir);
    let codex_base = expand_base_dir(home, codex_home, || home.join(".codex"));
    let antigravity_base =
        expand_base_dir(home, antigravity_cli_dir, || home.join(".gemini").join("antigravity-cli"));

    vec![
        ("claude", claude_base.join("projects")),
        ("codex", codex_base.join("sessions")),
        ("codex", codex_base.join("archived_sessions")),
        ("antigravity", antigravity_base.join("conversations")),
    ]
}

/// Thin wrapper reading the real `CLAUDE_CONFIG_DIR` / `CODEX_HOME` /
/// `ANTIGRAVITY_CLI_DIR` env vars, for production call sites.
pub fn roots_from_env(home: &Path) -> Vec<(&'static str, PathBuf)> {
    roots(
        home,
        std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref(),
        std::env::var("CODEX_HOME").ok().as_deref(),
        std::env::var("ANTIGRAVITY_CLI_DIR").ok().as_deref(),
    )
}

/// Resolves a base directory from an optional env override, expanding a
/// leading `~` against `home` (mirroring `claude_progress::config_base_dir`'s
/// convention), or falling back to `default()` when the override is unset or
/// blank.
fn expand_base_dir(home: &Path, env_value: Option<&str>, default: impl FnOnce() -> PathBuf) -> PathBuf {
    match env_value {
        Some(value) if !value.trim().is_empty() => {
            let path = Path::new(value);
            match path.strip_prefix("~") {
                Ok(rest) => home.join(rest),
                Err(_) => path.to_path_buf(),
            }
        }
        _ => default(),
    }
}

/// Discover every session source file across all three agents' roots, using
/// the real process env for root overrides.
pub fn discover(home: &Path) -> Vec<SessionFile> {
    discover_from_roots(&roots_from_env(home))
}

/// Core discovery logic, decoupled from env resolution so it can be tested
/// against arbitrary temp-dir roots without ever touching process env.
/// `pub(crate)` (rather than private) so sync.rs's full-sync tests can reuse
/// the same hermetic, env-free entry point instead of mutating process env.
pub(crate) fn discover_from_roots(roots: &[(&'static str, PathBuf)]) -> Vec<SessionFile> {
    let mut out = Vec::new();
    for (agent, root) in roots {
        match *agent {
            "claude" => discover_claude(root, &mut out),
            "codex" => {
                // The two Codex roots share the "codex" tag; tell them apart
                // by directory name, which is always exactly "sessions" or
                // "archived_sessions" no matter how CODEX_HOME is set.
                // Implicit contract: roots() is the only producer of these
                // pairs, so the basename check can't misclassify a root.
                if root.file_name().and_then(|n| n.to_str()) == Some("archived_sessions") {
                    discover_codex_archived(root, &mut out);
                } else {
                    discover_codex_sessions(root, &mut out);
                }
            }
            "antigravity" => discover_antigravity(root, &mut out),
            _ => {}
        }
    }
    out
}

/// True when `path`'s extension is exactly `ext` (case-sensitive, no dot).
fn has_extension(path: &Path, ext: &str) -> bool {
    path.extension().and_then(|e| e.to_str()) == Some(ext)
}

/// Every top-level `*.jsonl` file inside each project subdir of `root`.
/// Never recurses further: a `<session-id>/` companion directory inside a
/// project is a real thing Claude Code creates, and its contents are never
/// session transcripts.
fn discover_claude(root: &Path, out: &mut Vec<SessionFile>) {
    let Ok(project_dirs) = std::fs::read_dir(root) else { return };
    for project_entry in project_dirs.flatten() {
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }
        let Ok(files) = std::fs::read_dir(&project_path) else { continue };
        for file_entry in files.flatten() {
            let path = file_entry.path();
            if path.is_file() && has_extension(&path, "jsonl") {
                out.push(SessionFile { agent: "claude", path });
            }
        }
    }
}

/// True when `name` matches Codex's rollout file naming, `rollout-*.jsonl`.
fn is_rollout_jsonl(name: &str) -> bool {
    name.starts_with("rollout-") && name.ends_with(".jsonl")
}

/// `rollout-*.jsonl` files under `root`, recursing into the `YYYY/MM/DD`
/// directory layout but never past `CODEX_SESSIONS_MAX_NESTED_DIRS` levels.
fn discover_codex_sessions(root: &Path, out: &mut Vec<SessionFile>) {
    walk_codex_sessions(root, 0, out);
}

fn walk_codex_sessions(dir: &Path, depth: u32, out: &mut Vec<SessionFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Only descend while the subdirectory itself would still be
            // within the allowed nesting (YYYY/MM/DD); anything deeper is
            // silently excluded by never being visited at all.
            if depth < CODEX_SESSIONS_MAX_NESTED_DIRS {
                walk_codex_sessions(&path, depth + 1, out);
            }
            continue;
        }
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if is_rollout_jsonl(name) {
                out.push(SessionFile { agent: "codex", path: path.clone() });
            }
        }
    }
}

/// Every top-level `*.jsonl` file directly under `archived_sessions/`; flat,
/// no recursion, and (unlike `sessions/`) no `rollout-` prefix filter.
fn discover_codex_archived(root: &Path, out: &mut Vec<SessionFile>) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && has_extension(&path, "jsonl") {
            out.push(SessionFile { agent: "codex", path });
        }
    }
}

/// Every top-level `*.db` file directly under `conversations/`. SQLite's
/// `-wal`/`-shm` companions and a `.db-journal` file all fail the exact
/// `db` extension check, so they're excluded without any special-casing.
fn discover_antigravity(root: &Path, out: &mut Vec<SessionFile>) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && has_extension(&path, "db") {
            out.push(SessionFile { agent: "antigravity", path });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tt-scanner-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Creates an empty file at `path`, creating any missing parent dirs.
    /// Discovery only ever looks at names/extensions/dir structure, so an
    /// empty file is a perfectly good fixture.
    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"").unwrap();
    }

    fn sorted(mut files: Vec<SessionFile>) -> Vec<SessionFile> {
        files.sort_by(|a, b| (a.agent, &a.path).cmp(&(b.agent, &b.path)));
        files
    }

    // --- discover_from_roots: the main discovery-rules test -----------------

    #[test]
    fn discover_returns_expected_files_and_excludes_all_decoys() {
        let home = temp_home("discover-all");

        // Claude: two projects, each with top-level jsonl files; a nested
        // session-id-style subdir with its own jsonl is a decoy that must
        // never be picked up (never recurse past the project directory).
        let claude_a1 = home.join(".claude/projects/projA/session1.jsonl");
        let claude_a2 = home.join(".claude/projects/projA/session2.jsonl");
        let claude_decoy = home.join(".claude/projects/projA/session-id-dir/nested.jsonl");
        let claude_b1 = home.join(".claude/projects/projB/other.jsonl");
        for p in [&claude_a1, &claude_a2, &claude_decoy, &claude_b1] {
            touch(p);
        }

        // Codex sessions/: rollout files nested three levels deep
        // (YYYY/MM/DD) are kept; a non-rollout jsonl at the same depth is a
        // decoy, and a rollout file one level deeper than allowed is too.
        let codex_1 = home.join(".codex/sessions/2026/07/07/rollout-abc.jsonl");
        let codex_2 = home.join(".codex/sessions/2026/07/07/rollout-def.jsonl");
        let codex_decoy_pattern = home.join(".codex/sessions/2026/07/07/not-a-rollout.jsonl");
        let codex_decoy_depth = home.join(".codex/sessions/2026/07/07/extra/rollout-toodeep.jsonl");
        for p in [&codex_1, &codex_2, &codex_decoy_pattern, &codex_decoy_depth] {
            touch(p);
        }

        // Codex archived_sessions/: flat, any *.jsonl, no recursion.
        let codex_archived = home.join(".codex/archived_sessions/rollout-old.jsonl");
        touch(&codex_archived);

        // Antigravity conversations/: only *.db; -wal/-shm/.db-journal
        // companions are decoys.
        let ag_db = home.join(".gemini/antigravity-cli/conversations/convo1.db");
        let ag_wal = home.join(".gemini/antigravity-cli/conversations/convo1.db-wal");
        let ag_shm = home.join(".gemini/antigravity-cli/conversations/convo1.db-shm");
        let ag_journal = home.join(".gemini/antigravity-cli/conversations/convo1.db-journal");
        for p in [&ag_db, &ag_wal, &ag_shm, &ag_journal] {
            touch(p);
        }

        let root_list = roots(&home, None, None, None);
        let found = sorted(discover_from_roots(&root_list));

        let expected = sorted(vec![
            SessionFile { agent: "antigravity", path: ag_db },
            SessionFile { agent: "claude", path: claude_a1 },
            SessionFile { agent: "claude", path: claude_a2 },
            SessionFile { agent: "claude", path: claude_b1 },
            SessionFile { agent: "codex", path: codex_1 },
            SessionFile { agent: "codex", path: codex_2 },
            SessionFile { agent: "codex", path: codex_archived },
        ]);

        assert_eq!(found, expected);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn claude_never_recurses_into_a_session_id_subdirectory() {
        let home = temp_home("claude-no-recurse");
        let kept = home.join(".claude/projects/proj/top.jsonl");
        let decoy = home.join(".claude/projects/proj/abc-session-id/nested.jsonl");
        touch(&kept);
        touch(&decoy);

        let found = discover_from_roots(&roots(&home, None, None, None));
        assert_eq!(found, vec![SessionFile { agent: "claude", path: kept }]);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn codex_sessions_stops_recursing_past_three_nested_directories() {
        let home = temp_home("codex-depth");
        let kept = home.join(".codex/sessions/2026/07/07/rollout-ok.jsonl");
        let too_deep = home.join(".codex/sessions/2026/07/07/extra/rollout-nope.jsonl");
        touch(&kept);
        touch(&too_deep);

        let found = discover_from_roots(&roots(&home, None, None, None));
        assert_eq!(found, vec![SessionFile { agent: "codex", path: kept }]);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn codex_sessions_filters_out_non_rollout_files() {
        let home = temp_home("codex-filter");
        let kept = home.join(".codex/sessions/2026/07/07/rollout-ok.jsonl");
        let decoy = home.join(".codex/sessions/2026/07/07/notes.jsonl");
        touch(&kept);
        touch(&decoy);

        let found = discover_from_roots(&roots(&home, None, None, None));
        assert_eq!(found, vec![SessionFile { agent: "codex", path: kept }]);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn codex_archived_sessions_is_flat_and_unfiltered_by_rollout_prefix() {
        let home = temp_home("codex-archived");
        let kept = home.join(".codex/archived_sessions/anything.jsonl");
        let nested_decoy = home.join(".codex/archived_sessions/sub/rollout-nope.jsonl");
        touch(&kept);
        touch(&nested_decoy);

        let found = discover_from_roots(&roots(&home, None, None, None));
        assert_eq!(found, vec![SessionFile { agent: "codex", path: kept }]);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn antigravity_skips_wal_shm_and_journal_companion_files() {
        let home = temp_home("antigravity-companions");
        let kept = home.join(".gemini/antigravity-cli/conversations/a.db");
        let wal = home.join(".gemini/antigravity-cli/conversations/a.db-wal");
        let shm = home.join(".gemini/antigravity-cli/conversations/a.db-shm");
        let journal = home.join(".gemini/antigravity-cli/conversations/a.db-journal");
        for p in [&kept, &wal, &shm, &journal] {
            touch(p);
        }

        let found = discover_from_roots(&roots(&home, None, None, None));
        assert_eq!(found, vec![SessionFile { agent: "antigravity", path: kept }]);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn missing_roots_contribute_nothing_without_error() {
        // Only the antigravity tree exists; the claude/codex roots are
        // entirely absent. Discovery must not error and must return only
        // what actually exists on disk.
        let home = temp_home("missing-roots");
        let kept = home.join(".gemini/antigravity-cli/conversations/only.db");
        touch(&kept);

        let found = discover_from_roots(&roots(&home, None, None, None));
        assert_eq!(found, vec![SessionFile { agent: "antigravity", path: kept }]);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn discover_on_a_home_with_no_agent_trees_returns_empty() {
        // A home dir with none of the three trees present at all yields
        // nothing. Blank overrides mean "unset" (falling back to the
        // home-relative defaults), keeping the test hermetic on machines
        // where the real CLAUDE_CONFIG_DIR / CODEX_HOME / ANTIGRAVITY_CLI_DIR
        // env vars are set — the env-backed discover() would honor those and
        // walk real data trees.
        let home = temp_home("empty-home");
        let found = discover_from_roots(&roots(&home, Some(""), Some(""), Some("")));
        assert!(found.is_empty());
        let _ = std::fs::remove_dir_all(&home);
    }

    // --- roots(): env override resolution, no filesystem involved -----------

    #[test]
    fn roots_uses_defaults_when_all_overrides_are_absent() {
        let home = Path::new("/home/u");
        let result = roots(home, None, None, None);
        assert_eq!(
            result,
            vec![
                ("claude", PathBuf::from("/home/u/.claude/projects")),
                ("codex", PathBuf::from("/home/u/.codex/sessions")),
                ("codex", PathBuf::from("/home/u/.codex/archived_sessions")),
                ("antigravity", PathBuf::from("/home/u/.gemini/antigravity-cli/conversations")),
            ]
        );
    }

    #[test]
    fn roots_honors_claude_config_dir_override() {
        let home = Path::new("/home/u");
        let result = roots(home, Some("/custom/cc"), None, None);
        assert_eq!(result[0], ("claude", PathBuf::from("/custom/cc/projects")));
    }

    #[test]
    fn roots_honors_codex_home_override() {
        let home = Path::new("/home/u");
        let result = roots(home, None, Some("/custom/codex"), None);
        assert_eq!(result[1], ("codex", PathBuf::from("/custom/codex/sessions")));
        assert_eq!(result[2], ("codex", PathBuf::from("/custom/codex/archived_sessions")));
    }

    #[test]
    fn roots_honors_antigravity_cli_dir_override() {
        let home = Path::new("/home/u");
        let result = roots(home, None, None, Some("/custom/ag"));
        assert_eq!(result[3], ("antigravity", PathBuf::from("/custom/ag/conversations")));
    }

    #[test]
    fn roots_expands_a_leading_tilde_against_home_for_codex_and_antigravity() {
        let home = Path::new("/home/u");
        let result = roots(home, None, Some("~/.codex_custom"), Some("~/.ag_custom"));
        assert_eq!(result[1], ("codex", PathBuf::from("/home/u/.codex_custom/sessions")));
        assert_eq!(result[3], ("antigravity", PathBuf::from("/home/u/.ag_custom/conversations")));
    }

    #[test]
    fn roots_treats_a_blank_override_as_unset() {
        let home = Path::new("/home/u");
        let result = roots(home, Some("  "), Some(""), Some("   "));
        assert_eq!(
            result,
            vec![
                ("claude", PathBuf::from("/home/u/.claude/projects")),
                ("codex", PathBuf::from("/home/u/.codex/sessions")),
                ("codex", PathBuf::from("/home/u/.codex/archived_sessions")),
                ("antigravity", PathBuf::from("/home/u/.gemini/antigravity-cli/conversations")),
            ]
        );
    }
}
