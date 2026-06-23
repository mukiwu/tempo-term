//! SSH local (-L) port forwarding: bind a local TCP port and bridge each
//! accepted connection over the session's russh connection to a remote host.
//! `validate` is pure so the rule checks are unit-tested without binding sockets.

#[derive(Debug, Clone)]
pub struct ForwardSpec {
    pub id: String,
    pub bind_host: String,
    pub local_port: u16,
    pub dest_host: String,
    pub dest_port: u16,
}

/// Reject specs that can't bind or dial: empty hosts, zero ports. (u16 already
/// caps at 65535; 0 is the only invalid port value.)
pub fn validate(spec: &ForwardSpec) -> Result<(), String> {
    if spec.bind_host.trim().is_empty() {
        return Err("bind host is empty".into());
    }
    if spec.dest_host.trim().is_empty() {
        return Err("destination host is empty".into());
    }
    if spec.local_port == 0 {
        return Err("local port must be 1-65535".into());
    }
    if spec.dest_port == 0 {
        return Err("destination port must be 1-65535".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(bind: &str, lp: u16, dh: &str, dp: u16) -> ForwardSpec {
        ForwardSpec { id: "f1".into(), bind_host: bind.into(), local_port: lp, dest_host: dh.into(), dest_port: dp }
    }

    #[test]
    fn accepts_a_valid_local_forward() {
        assert!(validate(&spec("127.0.0.1", 5432, "localhost", 5432)).is_ok());
    }

    #[test]
    fn rejects_zero_ports() {
        assert!(validate(&spec("127.0.0.1", 0, "localhost", 5432)).is_err());
        assert!(validate(&spec("127.0.0.1", 5432, "localhost", 0)).is_err());
    }

    #[test]
    fn rejects_empty_hosts() {
        assert!(validate(&spec("", 5432, "localhost", 5432)).is_err());
        assert!(validate(&spec("127.0.0.1", 5432, "  ", 5432)).is_err());
    }
}
