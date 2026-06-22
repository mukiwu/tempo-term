//! Installs tempo-term's status hook into Codex's config so Codex sessions
//! report live state as OSC, mirroring the Claude installer. Reuses the shared
//! pure merge over hooks.json and ensures Codex's hooks feature flag is on.

use toml_edit::{DocumentMut, Item, Table, value};

/// Ensure `[features] hooks = true` in the given config.toml text, preserving all
/// other keys, tables, and comments. Returns the updated text. A blank input
/// yields a document containing just the features table.
pub fn ensure_hooks_feature(existing_toml: &str) -> Result<String, String> {
    let mut doc = existing_toml
        .parse::<DocumentMut>()
        .map_err(|e| format!("config.toml is not valid TOML: {e}"))?;
    // Ensure [features] exists as an explicit table header, not a dotted key
    if !doc.contains_table("features") {
        doc["features"] = Item::Table(Table::new());
    }
    doc["features"]["hooks"] = value(true);
    Ok(doc.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_hooks_feature_preserves_existing_keys_and_comments() {
        let input = "model = \"gpt-5.5\"\n# keep me\n[features]\nmulti_agent = true\n";
        let out = ensure_hooks_feature(input).unwrap();
        assert!(out.contains("model = \"gpt-5.5\""));
        assert!(out.contains("# keep me"));
        assert!(out.contains("multi_agent = true"));
        assert!(out.contains("hooks = true"));
    }

    #[test]
    fn ensure_hooks_feature_is_noop_when_already_true() {
        let input = "[features]\nhooks = true\n";
        let out = ensure_hooks_feature(input).unwrap();
        assert_eq!(out.matches("hooks = true").count(), 1);
    }

    #[test]
    fn ensure_hooks_feature_creates_features_table_when_absent() {
        let out = ensure_hooks_feature("model = \"x\"\n").unwrap();
        assert!(out.contains("[features]"));
        assert!(out.contains("hooks = true"));
    }

    #[test]
    fn ensure_hooks_feature_flips_false_to_true_keeping_other_keys() {
        let input = "[features]\nmulti_agent = true\nhooks = false\n";
        let out = ensure_hooks_feature(input).unwrap();
        assert!(out.contains("hooks = true"));
        assert!(!out.contains("hooks = false"));
        assert!(out.contains("multi_agent = true"));
    }

    #[test]
    fn ensure_hooks_feature_preserves_a_comment_inside_features() {
        let input = "[features]\n# flag for multi-agent\nmulti_agent = true\n";
        let out = ensure_hooks_feature(input).unwrap();
        assert!(out.contains("# flag for multi-agent"));
        assert!(out.contains("multi_agent = true"));
        assert!(out.contains("hooks = true"));
    }
}
