//! SSH client handler — implements `russh::client::Handler` for host-key
//! verification against an app-managed `known_hosts` file.
//!
//! `check_server_key` is the security-critical path: it classifies the
//! presented key (Trusted / Unknown / Changed), prompts the user through the
//! Tauri `ssh-prompt` event for anything not already trusted, awaits the reply,
//! and only persists the key on explicit approval. A Changed key is never
//! auto-accepted.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Emitter};

use super::known_hosts::{classify, known_hosts_line, HostKeyStatus};
use super::prompt::{PromptKind, PromptRegistry, PromptRequest};

/// The russh `Handler` that verifies the server's host key before the session
/// is allowed to proceed. Carries everything `check_server_key` needs to read
/// the known_hosts file, emit a prompt, and await the user's decision.
pub struct VerifyingClient {
    /// Used to emit the `ssh-prompt` Tauri event to the frontend.
    pub app: AppHandle,
    /// Shared registry that pairs a prompt id with the oneshot that the
    /// `ssh_prompt_reply` command resolves.
    pub registry: Arc<PromptRegistry>,
    /// `app_data_dir()/ssh_known_hosts` — the app-managed known_hosts file.
    pub known_hosts_path: PathBuf,
    /// Host the user asked to connect to (used as the known_hosts token).
    pub host: String,
    /// Port (drives bare-host vs `[host]:port` token form).
    pub port: u16,
    /// Session id, used to make the prompt request id unique per session.
    pub session_id: u32,
}

impl VerifyingClient {
    /// A prompt id unique to this session's host-key check.
    fn new_request_id(&self) -> String {
        format!("{}-hostkey", self.session_id)
    }
}

impl russh::client::Handler for VerifyingClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Build the presented key string ("<algo> <base64>") from the openssh
        // encoding. If the key cannot be encoded we refuse rather than risk
        // trusting an empty/garbage entry.
        let openssh = server_public_key
            .to_openssh()
            .map_err(|_| russh::Error::CouldNotReadKey)?;
        let presented: String = openssh
            .split_whitespace()
            .take(2)
            .collect::<Vec<_>>()
            .join(" ");

        // SHA256 fingerprint for display in the prompt (renders as "SHA256:...").
        let fingerprint = server_public_key
            .fingerprint(russh::keys::HashAlg::Sha256)
            .to_string();

        // Missing file = empty list (first-ever connection).
        let lines: Vec<String> = std::fs::read_to_string(&self.known_hosts_path)
            .unwrap_or_default()
            .lines()
            .map(|l| l.to_string())
            .collect();

        match classify(&lines, &self.host, self.port, &presented) {
            // Already pinned and matching — accept silently, no prompt.
            HostKeyStatus::Trusted => Ok(true),
            status => {
                let kind = match status {
                    HostKeyStatus::Changed => PromptKind::HostKeyChanged,
                    // Unknown (Trusted handled above).
                    _ => PromptKind::HostKeyUnknown,
                };

                let id = self.new_request_id();
                let rx = self.registry.register(&id);
                self.app
                    .emit(
                        "ssh-prompt",
                        PromptRequest {
                            id,
                            kind,
                            message: fingerprint,
                        },
                    )
                    .map_err(|_| russh::Error::Disconnect)?;

                // Await the user's decision. A dropped sender (registry gone /
                // session torn down) aborts the connection.
                let reply = rx.await.map_err(|_| russh::Error::Disconnect)?;

                if reply.approved {
                    // Unknown -> append; Changed -> replace this host's lines.
                    // `persist_host_key` handles both by removing any existing
                    // lines for the host token before appending the new one.
                    persist_host_key(
                        &self.known_hosts_path,
                        &lines,
                        &self.host,
                        self.port,
                        &presented,
                    )
                    .map_err(|_| russh::Error::Disconnect)?;
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
        }
    }
}

/// Rewrite the known_hosts file so the host token has exactly one line: the
/// newly-approved key.
///
/// Works for both the Unknown case (no existing line, so this is an append) and
/// the Changed case (drops the host's stale line(s) first). Other hosts'
/// entries, comments, and blank lines are preserved. Parent directories are
/// created so the very first write succeeds.
fn persist_host_key(
    path: &Path,
    lines: &[String],
    host: &str,
    port: u16,
    key: &str,
) -> std::io::Result<()> {
    let token = host_token(host, port);
    let mut kept: Vec<String> = lines
        .iter()
        .filter(|raw| {
            let trimmed = raw.trim();
            // Keep comments / blanks untouched.
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return true;
            }
            // Drop only entries whose first field is exactly this host token,
            // matching how `classify` keys entries (avoids prefix false matches
            // like "host" vs "host2").
            let entry_host = trimmed
                .split(char::is_whitespace)
                .next()
                .unwrap_or("");
            entry_host != token
        })
        .map(|l| l.to_string())
        .collect();

    kept.push(known_hosts_line(host, port, key));

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, kept.join("\n") + "\n")
}

/// The known_hosts token for a host: bare host on port 22, `[host]:port`
/// otherwise (OpenSSH convention; mirrors `known_hosts::host_token`).
fn host_token(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

/// Inputs needed to open a verified SSH connection.
pub struct ConnectArgs {
    /// Pre-built handler carrying the host-key verification context.
    pub handler: VerifyingClient,
    /// Host to dial.
    pub host: String,
    /// Port to dial.
    pub port: u16,
}

/// Open a TCP connection and run the SSH transport handshake, verifying the
/// host key via `VerifyingClient::check_server_key`. Returns the connected
/// handle (authentication is performed by the caller in a later task).
pub async fn connect(
    args: ConnectArgs,
) -> Result<russh::client::Handle<VerifyingClient>, String> {
    let config = Arc::new(russh::client::Config::default());
    russh::client::connect(config, (args.host.as_str(), args.port), args.handler)
        .await
        .map_err(|e| e.to_string())
}
