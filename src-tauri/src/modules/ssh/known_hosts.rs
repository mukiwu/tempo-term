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
fn host_token(host: &str, port: u16) -> String {
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
}
