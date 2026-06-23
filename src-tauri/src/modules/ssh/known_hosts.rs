//! Pure parsing and classification of an app-managed known_hosts file.
//! No IO here so the decision logic is unit-testable.

#[derive(Debug, PartialEq, Eq)]
pub enum HostKeyStatus {
    Trusted,
    Unknown,
    Changed,
}

/// The host token an entry is keyed by: bare host on port 22, `[host]:port`
/// otherwise (OpenSSH convention).
pub(crate) fn host_token(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

/// Compare a presented key (`"<type> <base64>"`, no comment) against the file.
pub fn classify(lines: &[String], host: &str, port: u16, presented_key: &str) -> HostKeyStatus {
    let token = host_token(host, port);
    let presented = presented_key.trim();
    let mut seen_host = false;
    for raw in lines {
        let l = raw.trim();
        if l.is_empty() || l.starts_with('#') {
            continue;
        }
        let mut parts = l.splitn(2, char::is_whitespace);
        let entry_host = parts.next().unwrap_or("");
        let entry_key = parts.next().unwrap_or("").trim();
        if entry_host != token {
            continue;
        }
        seen_host = true;
        if entry_key == presented {
            return HostKeyStatus::Trusted;
        }
    }
    if seen_host {
        HostKeyStatus::Changed
    } else {
        HostKeyStatus::Unknown
    }
}

/// Remove every existing entry for `token` and append `new_line`.
/// Comments and blank lines are preserved. This is the filter+append
/// primitive for both the Unknown (new host) and Changed (stale key)
/// cases in `persist_host_key`.
pub(crate) fn rewrite_lines(lines: &[String], token: &str, new_line: &str) -> Vec<String> {
    let mut kept: Vec<String> = lines
        .iter()
        .filter(|raw| {
            let trimmed = raw.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return true;
            }
            let entry_host = trimmed
                .split(char::is_whitespace)
                .next()
                .unwrap_or("");
            entry_host != token
        })
        .map(|l| l.to_string())
        .collect();
    kept.push(new_line.to_string());
    kept
}

/// The line to append when the user trusts a key.
pub fn known_hosts_line(host: &str, port: u16, key: &str) -> String {
    format!("{} {}", host_token(host, port), key.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(h: &str, k: &str) -> String { format!("{h} ssh-ed25519 {k}") }

    #[test]
    fn unknown_when_host_absent() {
        let lines = vec![line("other", "AAAA")];
        assert!(matches!(classify(&lines, "h", 22, "ssh-ed25519 BBBB"), HostKeyStatus::Unknown));
    }

    #[test]
    fn trusted_when_key_matches() {
        let lines = vec![line("h", "BBBB")];
        assert!(matches!(classify(&lines, "h", 22, "ssh-ed25519 BBBB"), HostKeyStatus::Trusted));
    }

    #[test]
    fn changed_when_key_differs() {
        let lines = vec![line("h", "BBBB")];
        assert!(matches!(classify(&lines, "h", 22, "ssh-ed25519 CCCC"), HostKeyStatus::Changed));
    }

    #[test]
    fn non_default_port_uses_bracket_form() {
        let lines = vec![line("[h]:2222", "BBBB")];
        assert!(matches!(classify(&lines, "h", 2222, "ssh-ed25519 BBBB"), HostKeyStatus::Trusted));
        assert_eq!(known_hosts_line("h", 2222, "ssh-ed25519 BBBB"), "[h]:2222 ssh-ed25519 BBBB");
        assert_eq!(known_hosts_line("h", 22, "ssh-ed25519 BBBB"), "h ssh-ed25519 BBBB");
    }

    // --- rewrite_lines tests ---

    #[test]
    fn append_when_absent() {
        let lines: Vec<String> = vec![];
        let result = rewrite_lines(&lines, "h", "h ssh-ed25519 NEWKEY");
        assert_eq!(result, vec!["h ssh-ed25519 NEWKEY".to_string()]);
    }

    #[test]
    fn replace_single() {
        let lines = vec!["h ssh-ed25519 OLDKEY".to_string()];
        let result = rewrite_lines(&lines, "h", "h ssh-ed25519 NEWKEY");
        assert_eq!(result, vec!["h ssh-ed25519 NEWKEY".to_string()]);
    }

    #[test]
    fn replace_duplicates() {
        let lines = vec![
            "h ssh-ed25519 STALE1".to_string(),
            "h ssh-ed25519 STALE2".to_string(),
        ];
        let result = rewrite_lines(&lines, "h", "h ssh-ed25519 NEWKEY");
        assert_eq!(result, vec!["h ssh-ed25519 NEWKEY".to_string()]);
    }

    #[test]
    fn do_not_touch_look_alike() {
        let lines = vec![
            "h ssh-ed25519 KEEP".to_string(),
            "h2 ssh-ed25519 ALSO_KEEP".to_string(),
        ];
        let result = rewrite_lines(&lines, "h", "h ssh-ed25519 NEWKEY");
        assert_eq!(result, vec![
            "h2 ssh-ed25519 ALSO_KEEP".to_string(),
            "h ssh-ed25519 NEWKEY".to_string(),
        ]);
    }
}
