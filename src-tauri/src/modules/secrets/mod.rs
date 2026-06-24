//! Secure storage for provider API keys via the OS keychain (keyring crate).
//! Keys are written and cleared from the frontend, but only read inside the
//! backend (the ai module) so they never travel back to the webview.

mod file_store;

use std::path::PathBuf;
use std::sync::OnceLock;

use keyring::Entry;
use orion::aead::SecretKey;

const SSH_SERVICE: &str = "tempoterm-ssh";

/// Domain-separation salt mixed with the machine id before hashing into the
/// file-store key. Bumping this invalidates every stored value.
const APP_SALT: &str = "tempoterm.secrets.v1";

/// Absolute path to the encrypted secrets file, resolved once at app startup.
static SECRETS_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Wire the encrypted secrets file path from the Tauri setup hook
/// (`app_data_dir()/secrets.enc`).
pub fn init_store_path(path: PathBuf) {
    let _ = SECRETS_PATH.set(path);
}

fn secrets_path() -> Result<PathBuf, String> {
    SECRETS_PATH
        .get()
        .cloned()
        .ok_or_else(|| "secrets store not initialized".to_string())
}

/// Derive the file-store encryption key from this machine's id. The key only
/// lives in memory; a file copied to another machine will not decrypt.
fn machine_key() -> Result<SecretKey, String> {
    let id = machine_uid::get().map_err(|e| e.to_string())?;
    let digest =
        orion::hash::digest(format!("{APP_SALT}:{id}").as_bytes()).map_err(|e| e.to_string())?;
    SecretKey::from_slice(digest.as_ref()).map_err(|e| e.to_string())
}

fn account_for(provider: &str) -> String {
    format!("provider:{provider}")
}

fn ssh_account_for(connection_id: &str) -> String {
    format!("connection:{connection_id}")
}

fn ssh_entry(connection_id: &str) -> Result<Entry, String> {
    Entry::new(SSH_SERVICE, &ssh_account_for(connection_id)).map_err(|e| e.to_string())
}

pub fn set_key(provider: &str, key: &str) -> Result<(), String> {
    file_store::set(&secrets_path()?, &machine_key()?, &account_for(provider), key)
}

pub fn get_key(provider: &str) -> Result<Option<String>, String> {
    // A missing machine id (or an undecryptable file) reads as "no key" so the
    // UI prompts for re-entry rather than surfacing a cryptic error.
    let key = match machine_key() {
        Ok(k) => k,
        Err(_) => return Ok(None),
    };
    file_store::get(&secrets_path()?, &key, &account_for(provider))
}

pub fn delete_key(provider: &str) -> Result<(), String> {
    file_store::delete(&secrets_path()?, &account_for(provider))
}

pub fn has_key(provider: &str) -> bool {
    match (secrets_path(), machine_key()) {
        (Ok(path), Ok(key)) => file_store::has(&path, &key, &account_for(provider)),
        _ => false,
    }
}

#[tauri::command]
pub fn secrets_set_key(provider: String, key: String) -> Result<(), String> {
    set_key(&provider, &key)
}

#[tauri::command]
pub fn secrets_delete_key(provider: String) -> Result<(), String> {
    delete_key(&provider)
}

#[tauri::command]
pub fn secrets_has_key(provider: String) -> bool {
    has_key(&provider)
}

// ---------------------------------------------------------------------------
// SSH secrets — passwords / key passphrases keyed by connection id.
//
// Stored under a distinct `tempoterm-ssh` service so they never collide with
// the AI provider keys. The value is read ONLY inside the backend (the ssh
// auth dispatch) via `ssh_get_secret`, which is deliberately NOT a Tauri
// command so a stored SSH secret can never travel back to the webview.
// ---------------------------------------------------------------------------

/// Read the stored SSH secret (password or key passphrase) for a connection.
/// Backend-only: never exposed as a command so the secret stays in the backend.
/// A missing entry is `Ok(None)`, not an error.
pub fn ssh_get_secret(connection_id: &str) -> Result<Option<String>, String> {
    match ssh_entry(connection_id)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn ssh_secret_set(connection_id: String, secret: String) -> Result<(), String> {
    ssh_entry(&connection_id)?
        .set_password(&secret)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ssh_secret_delete(connection_id: String) -> Result<(), String> {
    match ssh_entry(&connection_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_name_is_namespaced_per_provider() {
        assert_eq!(account_for("openai"), "provider:openai");
        assert_eq!(account_for("anthropic"), "provider:anthropic");
        assert_ne!(account_for("openai"), account_for("anthropic"));
    }

    #[test]
    fn ssh_account_name_is_namespaced_per_connection() {
        assert_eq!(ssh_account_for("conn-1"), "connection:conn-1");
        assert_eq!(ssh_account_for("conn-2"), "connection:conn-2");
        assert_ne!(ssh_account_for("conn-1"), ssh_account_for("conn-2"));
    }
}
