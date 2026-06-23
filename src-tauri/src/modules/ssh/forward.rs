//! SSH local (-L) port forwarding: bind a local TCP port and bridge each
//! accepted connection over the session's russh connection to a remote host.
//! `validate` is pure so the rule checks are unit-tested without binding sockets.

use std::sync::Arc;

use tokio::net::TcpListener;
use tokio::sync::watch;

use super::client::VerifyingClient;

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

/// Bind `spec.bind_host:spec.local_port` locally and bridge every accepted TCP
/// connection over the SSH session's russh handle via a `direct-tcpip` channel.
///
/// Returns `Err(reason)` immediately if the local bind fails (the caller emits
/// a `failed` event). Returns `Ok(())` when `cancel` fires with `true` (clean
/// shutdown). A dial failure on a per-connection task closes only that connection
/// and never the listener — the accept loop continues.
///
/// **Unpin note**: `ChannelStream<Msg>` is not `Unpin` because `ChannelTx`
/// holds a `Pin<Box<dyn Future>>`. We pin both halves with `tokio::pin!` inside
/// the per-connection task so `tokio::io::copy_bidirectional` is satisfied.
///
/// **Send note**: `Channel<Msg>` and `ChannelStream<Msg>` are `Send` (all inner
/// types are `Send`), so `tokio::spawn` accepts the per-connection future.
pub async fn run_forward(
    handle: Arc<russh::client::Handle<VerifyingClient>>,
    spec: ForwardSpec,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let listener = TcpListener::bind((spec.bind_host.as_str(), spec.local_port))
        .await
        .map_err(|e| format!("bind {}:{} failed: {e}", spec.bind_host, spec.local_port))?;

    loop {
        tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() {
                    return Ok(());
                }
            }
            accepted = listener.accept() => {
                let (mut local, _peer) = match accepted {
                    Ok(pair) => pair,
                    Err(_) => continue, // transient accept error; keep listening
                };
                let handle = Arc::clone(&handle);
                let dest_host = spec.dest_host.clone();
                let dest_port = spec.dest_port as u32;
                // Spawn one task per connection. A channel-open failure closes
                // only this connection; the listener continues accepting.
                tokio::spawn(async move {
                    match handle
                        .channel_open_direct_tcpip(dest_host, dest_port, "127.0.0.1", 0)
                        .await
                    {
                        Ok(channel) => {
                            let remote = channel.into_stream();
                            // ChannelStream<Msg> is AsyncRead + AsyncWrite but not
                            // Unpin. Pin it on the stack so copy_bidirectional
                            // can poll it without boxing.
                            tokio::pin!(remote);
                            let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
                        }
                        Err(_) => {
                            // Remote refused or unreachable: drop the local conn.
                        }
                    }
                });
            }
        }
    }
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
