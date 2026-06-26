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
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use super::known_hosts::{classify, host_token, known_hosts_line, rewrite_lines, HostKeyStatus};
use super::prompt::{PromptKind, PromptRegistry, PromptReply, PromptRequest};

/// Guards concurrent writes to the app-managed known_hosts file.
/// Held only across the sync read+rewrite in `persist_host_key`.
static KNOWN_HOSTS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Emit an `ssh-prompt` to the frontend, register the request id, and await the
/// user's reply. This is the single emit+register+await primitive shared by the
/// host-key check and every interactive auth prompt.
///
/// The event is scoped to `window_label` (the window that initiated the
/// connection) with `emit_to`, so the prompt appears only there instead of being
/// broadcast to every open window.
///
/// The caller owns the `id` (so it can be made unique per prompt). A dropped
/// sender — registry gone, session torn down — surfaces as an `Err`, so an
/// abandoned prompt fails closed rather than silently succeeding.
async fn request_prompt(
    app: &AppHandle,
    window_label: &str,
    registry: &Arc<PromptRegistry>,
    id: String,
    kind: PromptKind,
    message: String,
) -> Result<PromptReply, String> {
    // Ensure the pending entry is removed no matter how we leave this function —
    // a failed emit, a dropped receiver, or the whole future being cancelled when
    // the connection unwinds. Without this the id would linger in the registry.
    struct CleanupGuard {
        registry: Arc<PromptRegistry>,
        id: String,
    }
    impl Drop for CleanupGuard {
        fn drop(&mut self) {
            self.registry.remove(&self.id);
        }
    }

    let rx = registry.register(&id);
    let _guard = CleanupGuard {
        registry: registry.clone(),
        id: id.clone(),
    };

    app.emit_to(window_label, "ssh-prompt", PromptRequest { id, kind, message })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "prompt cancelled".to_string())
}

/// The russh `Handler` that verifies the server's host key before the session
/// is allowed to proceed. Carries everything `check_server_key` needs to read
/// the known_hosts file, emit a prompt, and await the user's decision.
pub struct VerifyingClient {
    /// Used to emit the `ssh-prompt` Tauri event to the frontend.
    pub app: AppHandle,
    /// Label of the window that initiated this connection. The `ssh-prompt`
    /// event is scoped to this window so it doesn't broadcast to every window.
    pub window_label: String,
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

                // Emit the host-key prompt and await the user's decision. Any
                // failure (emit error or dropped sender — registry gone /
                // session torn down) aborts the connection, exactly as before.
                let reply = request_prompt(
                    &self.app,
                    &self.window_label,
                    &self.registry,
                    self.new_request_id(),
                    kind,
                    fingerprint,
                )
                .await
                .map_err(|_| russh::Error::Disconnect)?;

                if reply.approved {
                    // Unknown -> append; Changed -> replace this host's lines.
                    // `persist_host_key` handles both by removing any existing
                    // lines for the host token before appending the new one.
                    persist_host_key(
                        &self.known_hosts_path,
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
    host: &str,
    port: u16,
    key: &str,
) -> std::io::Result<()> {
    let _guard = KNOWN_HOSTS_LOCK.lock().unwrap();
    let lines: Vec<String> = std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|l| l.to_string())
        .collect();
    let token = host_token(host, port);
    let new_line = known_hosts_line(host, port, key);
    let kept = rewrite_lines(lines.as_slice(), &token, &new_line);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, kept.join("\n") + "\n")
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
/// How long to wait for the TCP connection before giving up. Only the TCP
/// connect is bounded by this — the SSH handshake that follows includes the
/// interactive host-key prompt, which legitimately waits on the user, so it must
/// NOT be under a timeout. An unreachable host or a filtered port is exactly what
/// would otherwise hang here (~75s on the OS SYN-retry timeout).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

pub async fn connect(
    args: ConnectArgs,
) -> Result<russh::client::Handle<VerifyingClient>, String> {
    let config = Arc::new(russh::client::Config::default());

    // Do the TCP connect ourselves with a timeout, then hand the live stream to
    // russh. Wrapping `russh::client::connect` directly would also time out the
    // host-key prompt, which must be allowed to wait for the user.
    let stream = tokio::time::timeout(
        CONNECT_TIMEOUT,
        tokio::net::TcpStream::connect((args.host.as_str(), args.port)),
    )
    .await
    .map_err(|_| {
        format!(
            "timed out after {}s connecting to {}:{}",
            CONNECT_TIMEOUT.as_secs(),
            args.host,
            args.port
        )
    })?
    .map_err(|e| format!("could not reach {}:{}: {e}", args.host, args.port))?;

    russh::client::connect_stream(config, stream, args.handler)
        .await
        .map_err(|e| e.to_string())
}

/// Expand a leading `~` or `~/` in `path` to `home`. A bare `~` becomes `home`;
/// `~/x` becomes `home/x`. Other shapes (absolute, relative, `~other/...`) are
/// returned unchanged. Pure so it can be unit-tested without touching the env.
fn expand_tilde_with(path: &str, home: &str) -> String {
    if path == "~" {
        return home.to_string();
    }
    match path.strip_prefix("~/") {
        Some(rest) => format!("{}/{}", home.trim_end_matches('/'), rest),
        None => path.to_string(),
    }
}

/// Expand a leading `~`/`~/` against `$HOME`. Shells expand the tilde before a
/// path ever reaches a program, but a key path typed into the UI (or pasted from
/// an `ssh -i ~/...` command) arrives literal, so the backend must do it here.
/// Mirrors the `$HOME` lookup used elsewhere (see `modules::fs::dir::home_dir`).
fn expand_tilde(path: &str) -> String {
    // `HOME` on Unix; Windows sets `USERPROFILE` instead, so fall back to it.
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    if home.is_empty() {
        path.to_string()
    } else {
        expand_tilde_with(path, &home)
    }
}

// ===========================================================================
// Authentication
//
// `authenticate` runs after `connect` on the returned handle and dispatches on
// the user's chosen method. Secrets (passwords / key passphrases) are read from
// the OS keyring (backend-only) or obtained through an `ssh-prompt`, and are
// never logged or returned to the webview. A prompt that is cancelled or fails
// fails the auth attempt (`Err`) — it never silently reports success.
// ===========================================================================

/// Everything the auth dispatch needs that isn't the transport handle itself.
pub struct AuthArgs {
    /// SSH username.
    pub user: String,
    /// `"password"` | `"keyFile"` | `"agent"`.
    pub auth_method: String,
    /// Path to the private key file (only used by `"keyFile"`).
    pub key_path: Option<String>,
    /// Stable id used to key this connection's stored secret in the keyring.
    pub connection_id: String,
}

/// Validate that the requested auth method is one we support.
/// Returns `Ok(())` for `"password"`, `"keyFile"`, `"agent"`, and
/// `Err("unsupported auth method: {method}")` for anything else.
fn validate_auth_method(method: &str) -> Result<(), String> {
    match method {
        "password" | "keyFile" | "agent" => Ok(()),
        other => Err(format!("unsupported auth method: {other}")),
    }
}

/// Authenticate the (already host-key-verified) connection using the method the
/// user selected. Returns `Ok(true)` if the server accepted the credentials,
/// `Ok(false)` if it rejected them, and `Err` on an operational failure (key
/// load error, cancelled prompt, transport error, unknown method).
pub async fn authenticate(
    handle: &mut russh::client::Handle<VerifyingClient>,
    args: &AuthArgs,
    registry: &Arc<PromptRegistry>,
    app: &AppHandle,
    window_label: &str,
    session_id: u32,
) -> Result<bool, String> {
    validate_auth_method(&args.auth_method)?;
    match args.auth_method.as_str() {
        "password" => {
            authenticate_password(handle, args, registry, app, window_label, session_id).await
        }
        "keyFile" => {
            authenticate_key_file(handle, args, registry, app, window_label, session_id).await
        }
        "agent" => authenticate_agent(handle, args).await,
        other => Err(format!("unsupported auth method: {other}")),
    }
}

/// Prompt the user for a secret (password or passphrase) and return their reply.
/// Wraps `request_prompt` with an auth-specific, per-session prompt id so the
/// reply routes back to this exact request.
async fn request_secret(
    app: &AppHandle,
    window_label: &str,
    registry: &Arc<PromptRegistry>,
    session_id: u32,
    kind: PromptKind,
    message: String,
) -> Result<PromptReply, String> {
    let tag = match kind {
        PromptKind::Password => "password",
        PromptKind::Passphrase => "passphrase",
        // Host-key kinds don't flow through here, but give them a stable id
        // rather than panicking if the set ever grows.
        PromptKind::HostKeyUnknown | PromptKind::HostKeyChanged => "hostkey",
    };
    request_prompt(
        app,
        window_label,
        registry,
        format!("{session_id}-{tag}"),
        kind,
        message,
    )
    .await
}

/// Password auth: try the stored secret first, then fall back to prompting.
/// On a successful prompt with `remember` set, persist the password to the
/// keyring. If the server only offers keyboard-interactive, satisfy it with the
/// same password.
async fn authenticate_password(
    handle: &mut russh::client::Handle<VerifyingClient>,
    args: &AuthArgs,
    registry: &Arc<PromptRegistry>,
    app: &AppHandle,
    window_label: &str,
    session_id: u32,
) -> Result<bool, String> {
    // 1. Try a previously stored password without bothering the user.
    if let Some(stored) = crate::modules::secrets::ssh_get_secret(&args.connection_id)? {
        let result = handle
            .authenticate_password(args.user.clone(), stored.clone())
            .await
            .map_err(|e| e.to_string())?;
        if result.success() {
            return Ok(true);
        }
        if let Some(true) =
            try_keyboard_interactive(handle, &args.user, &stored, &result).await?
        {
            return Ok(true);
        }
        // Stored password rejected — fall through to prompting.
    }

    // 2. Prompt the user for a password and retry.
    let reply = request_secret(
        app,
        window_label,
        registry,
        session_id,
        PromptKind::Password,
        "Enter password".to_string(),
    )
    .await?;
    if !reply.approved {
        return Ok(false);
    }
    let password = match reply.secret {
        Some(secret) => secret,
        // Approved with no secret can't authenticate; treat as a failed attempt.
        None => return Ok(false),
    };

    let result = handle
        .authenticate_password(args.user.clone(), password.clone())
        .await
        .map_err(|e| e.to_string())?;
    let ok = if result.success() {
        true
    } else {
        matches!(
            try_keyboard_interactive(handle, &args.user, &password, &result).await?,
            Some(true)
        )
    };

    // Only persist a password the server actually accepted, and only if the
    // user opted in.
    if ok && reply.remember {
        crate::modules::secrets::ssh_secret_set(
            args.connection_id.clone(),
            password,
        )?;
    }
    Ok(ok)
}

/// If the failed password attempt left keyboard-interactive on the table, try
/// it with the same password (the common single-prompt PAM case). Returns
/// `Ok(None)` when the server didn't offer keyboard-interactive, `Ok(Some(ok))`
/// otherwise.
async fn try_keyboard_interactive(
    handle: &mut russh::client::Handle<VerifyingClient>,
    user: &str,
    password: &str,
    last: &russh::client::AuthResult,
) -> Result<Option<bool>, String> {
    use russh::client::KeyboardInteractiveAuthResponse;
    use russh::MethodKind;

    // Only proceed if the server's failure response still lists
    // keyboard-interactive as an available method.
    let offered = match last {
        russh::client::AuthResult::Failure {
            remaining_methods, ..
        } => remaining_methods.contains(&MethodKind::KeyboardInteractive),
        russh::client::AuthResult::Success => return Ok(Some(true)),
    };
    if !offered {
        return Ok(None);
    }

    let mut response = handle
        .authenticate_keyboard_interactive_start(user.to_string(), None)
        .await
        .map_err(|e| e.to_string())?;

    // Answer every prompt round with the password until the server resolves the
    // attempt one way or the other. Bounded so a server that keeps sending info
    // requests can't spin this loop forever — give up (fail) after a few rounds.
    for _ in 0..16 {
        match response {
            KeyboardInteractiveAuthResponse::Success => return Ok(Some(true)),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(Some(false)),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                let answers = vec![password.to_string(); prompts.len()];
                response = handle
                    .authenticate_keyboard_interactive_respond(answers)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(Some(false))
}

/// Key-file auth: load the private key, decrypting with the stored passphrase or
/// a prompted one if it's encrypted, then authenticate with publickey. On a
/// successful prompt with `remember` set, persist the passphrase.
async fn authenticate_key_file(
    handle: &mut russh::client::Handle<VerifyingClient>,
    args: &AuthArgs,
    registry: &Arc<PromptRegistry>,
    app: &AppHandle,
    window_label: &str,
    session_id: u32,
) -> Result<bool, String> {
    let key_path_raw = args
        .key_path
        .as_deref()
        .ok_or_else(|| "key file auth requires a key path".to_string())?;
    // The path may be typed or pasted with a leading `~` (e.g. from an
    // `ssh -i ~/.ssh/id_ed25519` command); russh reads the file as-is and would
    // not find it, so expand the tilde against `$HOME` first.
    let key_path = expand_tilde(key_path_raw);
    let key_path = key_path.as_str();

    // Try unencrypted first. If the key is encrypted, russh signals it with
    // `Error::KeyIsEncrypted`, which is our cue to obtain a passphrase.
    let key = match russh::keys::load_secret_key(key_path, None) {
        Ok(key) => key,
        Err(russh::keys::Error::KeyIsEncrypted) => {
            load_encrypted_key(key_path, args, registry, app, window_label, session_id).await?
        }
        Err(e) => return Err(format!("failed to load key file: {e}")),
    };

    authenticate_with_private_key(handle, &args.user, key).await
}

/// Decrypt an encrypted private key: try the stored passphrase first, otherwise
/// prompt. On a successful prompt with `remember` set, persist the passphrase.
async fn load_encrypted_key(
    key_path: &str,
    args: &AuthArgs,
    registry: &Arc<PromptRegistry>,
    app: &AppHandle,
    window_label: &str,
    session_id: u32,
) -> Result<russh::keys::PrivateKey, String> {
    // 1. Stored passphrase, if any.
    if let Some(stored) = crate::modules::secrets::ssh_get_secret(&args.connection_id)? {
        if let Ok(key) = russh::keys::load_secret_key(key_path, Some(&stored)) {
            return Ok(key);
        }
        // Stored passphrase is stale — fall through to prompting.
    }

    // 2. Prompt for the passphrase.
    let reply = request_secret(
        app,
        window_label,
        registry,
        session_id,
        PromptKind::Passphrase,
        "Enter key passphrase".to_string(),
    )
    .await?;
    if !reply.approved {
        return Err("passphrase prompt cancelled".to_string());
    }
    let passphrase = reply
        .secret
        .ok_or_else(|| "no passphrase provided".to_string())?;

    let key = russh::keys::load_secret_key(key_path, Some(&passphrase))
        .map_err(|e| format!("failed to decrypt key: {e}"))?;

    if reply.remember {
        crate::modules::secrets::ssh_secret_set(
            args.connection_id.clone(),
            passphrase,
        )?;
    }
    Ok(key)
}

/// Authenticate with a loaded private key, choosing the best RSA hash the server
/// advertises (so RSA keys aren't forced onto legacy SHA-1).
async fn authenticate_with_private_key(
    handle: &mut russh::client::Handle<VerifyingClient>,
    user: &str,
    key: russh::keys::PrivateKey,
) -> Result<bool, String> {
    // For RSA keys, ask the server which hash it prefers; non-RSA keys ignore
    // the hash. `best_supported_rsa_hash` returns Some(hash) when the server
    // advertised its sig-algs, None otherwise — fall back to None (legacy) only
    // when the server told us nothing.
    let hash_alg = if key.algorithm().is_rsa() {
        handle
            .best_supported_rsa_hash()
            .await
            .map_err(|e| e.to_string())?
            .flatten()
    } else {
        None
    };

    let key_with_hash =
        russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg);
    let result = handle
        .authenticate_publickey(user.to_string(), key_with_hash)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.success())
}

/// The public keys worth trying from what the agent offered, in agent order.
/// Certificate identities need a different auth call and are out of scope, so
/// they are skipped.
fn agent_public_keys(
    identities: Vec<russh::keys::agent::AgentIdentity>,
) -> Vec<russh::keys::PublicKey> {
    use russh::keys::agent::AgentIdentity;
    identities
        .into_iter()
        .filter_map(|identity| match identity {
            AgentIdentity::PublicKey { key, .. } => Some(key),
            AgentIdentity::Certificate { .. } => None,
        })
        .collect()
}

/// Try each public key the agent holds until one authenticates. Generic over
/// the agent transport `S` so the unix socket and the Windows named pipe /
/// Pageant agents — different concrete stream types — share one loop. The agent
/// does the signing, so no private key material reaches this process.
async fn try_agent_identities<S>(
    handle: &mut russh::client::Handle<VerifyingClient>,
    args: &AuthArgs,
    mut agent: russh::keys::agent::client::AgentClient<S>,
) -> Result<bool, String>
where
    S: russh::keys::agent::client::AgentStream + Unpin + Send,
{
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("could not list agent identities: {e}"))?;

    for public_key in agent_public_keys(identities) {
        let result = handle
            .authenticate_publickey_with(args.user.clone(), public_key, None, &mut agent)
            .await
            .map_err(|e| e.to_string())?;
        if result.success() {
            return Ok(true);
        }
    }

    Ok(false)
}

/// Agent auth on unix: reach the agent over the unix-domain socket named by
/// `SSH_AUTH_SOCK` (russh's `connect_env`, which is unix-only).
#[cfg(unix)]
async fn authenticate_agent(
    handle: &mut russh::client::Handle<VerifyingClient>,
    args: &AuthArgs,
) -> Result<bool, String> {
    use russh::keys::agent::client::AgentClient;

    let agent = AgentClient::connect_env()
        .await
        .map_err(|e| format!("could not connect to ssh-agent: {e}"))?;
    try_agent_identities(handle, args, agent).await
}

/// Agent auth on Windows: `connect_env` is unix-only, so reach the OpenSSH agent
/// over its fixed named pipe, falling back to Pageant (PuTTY). The two
/// transports are different stream types, so each arm hands its agent to the
/// shared `try_agent_identities`.
#[cfg(windows)]
async fn authenticate_agent(
    handle: &mut russh::client::Handle<VerifyingClient>,
    args: &AuthArgs,
) -> Result<bool, String> {
    use russh::keys::agent::client::AgentClient;

    // OpenSSH's agent on Windows listens on this fixed named pipe.
    const OPENSSH_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

    match AgentClient::connect_named_pipe(OPENSSH_AGENT_PIPE).await {
        Ok(agent) => try_agent_identities(handle, args, agent).await,
        Err(pipe_err) => {
            // No OpenSSH agent pipe; try Pageant before giving up.
            let agent = AgentClient::connect_pageant().await.map_err(|pageant_err| {
                format!(
                    "could not connect to ssh-agent: OpenSSH named pipe ({pipe_err}) \
                     and Pageant ({pageant_err}) both unavailable"
                )
            })?;
            try_agent_identities(handle, args, agent).await
        }
    }
}

/// Platforms that are neither unix nor Windows have no agent transport wired up;
/// fail clearly so the other auth methods (password, key file) keep working.
#[cfg(not(any(unix, windows)))]
async fn authenticate_agent(
    _handle: &mut russh::client::Handle<VerifyingClient>,
    _args: &AuthArgs,
) -> Result<bool, String> {
    Err("ssh-agent authentication is not supported on this platform; use password or a key file"
        .to_string())
}

/// Public alias for the shared prompt registry handle, so sibling modules can
/// name the type of `SshState.registry` without touching `prompt`'s internals.
pub type PromptRegistryHandle = PromptRegistry;

/// Everything needed to open a fresh, fully-authenticated SSH connection that
/// reuses the same host-key verification and keyring secret lookup the shell
/// uses. Used by the sftp module so SFTP rides its own connection without
/// duplicating auth.
pub struct AuthedConnectArgs {
    pub app: AppHandle,
    pub window_label: String,
    pub registry: Arc<PromptRegistry>,
    pub known_hosts_path: PathBuf,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_method: String,
    pub key_path: Option<String>,
    pub connection_id: String,
    pub session_id: u32,
}

/// Connect, verify the host key, and authenticate in one call. Returns the live
/// handle on success; `Err` on connect failure, rejected credentials, or a
/// cancelled prompt.
pub async fn connect_authenticated(
    args: AuthedConnectArgs,
) -> Result<russh::client::Handle<VerifyingClient>, String> {
    let handler = VerifyingClient {
        app: args.app.clone(),
        window_label: args.window_label.clone(),
        registry: args.registry.clone(),
        known_hosts_path: args.known_hosts_path,
        host: args.host.clone(),
        port: args.port,
        session_id: args.session_id,
    };
    let mut handle = connect(ConnectArgs {
        handler,
        host: args.host.clone(),
        port: args.port,
    })
    .await?;
    let auth = AuthArgs {
        user: args.user,
        auth_method: args.auth_method,
        key_path: args.key_path,
        connection_id: args.connection_id,
    };
    match authenticate(
        &mut handle,
        &auth,
        &args.registry,
        &args.app,
        &args.window_label,
        args.session_id,
    )
    .await?
    {
        true => Ok(handle),
        false => Err("authentication failed".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_leading_tilde_slash_to_home() {
        assert_eq!(
            expand_tilde_with("~/Documents/key.pem", "/Users/muki"),
            "/Users/muki/Documents/key.pem"
        );
    }

    #[test]
    fn expands_bare_tilde_to_home() {
        assert_eq!(expand_tilde_with("~", "/Users/muki"), "/Users/muki");
    }

    #[test]
    fn tolerates_a_home_with_a_trailing_slash() {
        assert_eq!(
            expand_tilde_with("~/key.pem", "/Users/muki/"),
            "/Users/muki/key.pem"
        );
    }

    #[test]
    fn leaves_absolute_and_relative_paths_untouched() {
        assert_eq!(
            expand_tilde_with("/abs/key.pem", "/Users/muki"),
            "/abs/key.pem"
        );
        assert_eq!(expand_tilde_with("key.pem", "/Users/muki"), "key.pem");
    }

    #[test]
    fn does_not_expand_other_users_home() {
        // `~other/x` is a different user's home — out of scope; leave it as-is.
        assert_eq!(
            expand_tilde_with("~other/key.pem", "/Users/muki"),
            "~other/key.pem"
        );
    }

    #[test]
    fn valid_auth_methods_return_ok() {
        assert!(validate_auth_method("password").is_ok());
        assert!(validate_auth_method("keyFile").is_ok());
        assert!(validate_auth_method("agent").is_ok());
    }

    #[test]
    fn unknown_auth_method_returns_err_with_unsupported() {
        let result = validate_auth_method("ftp");
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("unsupported"), "expected 'unsupported' in: {msg}");
    }

    #[test]
    fn agent_public_keys_keeps_keys_in_order_and_skips_certificates() {
        use russh::keys::agent::AgentIdentity;
        use russh::keys::{Certificate, PublicKey};

        let key_one = PublicKey::from_openssh(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKk10T4VJ8XEFRzgKqrW4pWkOphcTC0KezIr3y07ppvu key-one@test",
        )
        .unwrap();
        let key_two = PublicKey::from_openssh(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOlVLOKR+D57c6Y1e1JTtthtlrBxz2qrYQ68CXAdCftv key-two@test",
        )
        .unwrap();
        let certificate = Certificate::from_openssh(
            "ssh-ed25519-cert-v01@openssh.com AAAAIHNzaC1lZDI1NTE5LWNlcnQtdjAxQG9wZW5zc2guY29tAAAAIA5t7M3nXsYlqqOMpf+70YhnFGJs8eCt6e7jG10QOvpyAAAAIOlVLOKR+D57c6Y1e1JTtthtlrBxz2qrYQ68CXAdCftvAAAAAAAAAAAAAAABAAAAB3Rlc3QtaWQAAAAMAAAACHRlc3R1c2VyAAAAAGo+FKwAAAAAbB329AAAAAAAAACCAAAAFXBlcm1pdC1YMTEtZm9yd2FyZGluZwAAAAAAAAAXcGVybWl0LWFnZW50LWZvcndhcmRpbmcAAAAAAAAAFnBlcm1pdC1wb3J0LWZvcndhcmRpbmcAAAAAAAAACnBlcm1pdC1wdHkAAAAAAAAADnBlcm1pdC11c2VyLXJjAAAAAAAAAAAAAAAzAAAAC3NzaC1lZDI1NTE5AAAAINDE0xz3yvBWfeJlm6e7wgee6dqKv0eTQpBnbVLnSZGsAAAAUwAAAAtzc2gtZWQyNTUxOQAAAEBc2gwXbr0YxQPOo5xGAB1gQQiLdFOvnj6PNj7wCGHCP4khsFxbd14WKHiP3k4CN4D+bk+7QgniXVJl7QkE/10G key-two@test",
        )
        .unwrap();

        let identities = vec![
            AgentIdentity::PublicKey {
                key: key_one.clone(),
                comment: "one".to_string(),
            },
            AgentIdentity::Certificate {
                certificate,
                comment: "cert".to_string(),
            },
            AgentIdentity::PublicKey {
                key: key_two.clone(),
                comment: "two".to_string(),
            },
        ];

        // Certificates are out of scope and dropped; plain public keys are tried
        // in the order the agent offered them.
        assert_eq!(agent_public_keys(identities), vec![key_one, key_two]);
    }

    #[test]
    fn agent_public_keys_empty_when_agent_has_nothing() {
        assert!(agent_public_keys(Vec::new()).is_empty());
    }
}
