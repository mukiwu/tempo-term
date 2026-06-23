//! Secure storage for provider API keys via the OS keychain (keyring crate).
//! Keys are written and cleared from the frontend, but only read inside the
//! backend (the ai module) so they never travel back to the webview.

use keyring::Entry;

const SERVICE: &str = "tempoterm-ai";
const SSH_SERVICE: &str = "tempoterm-ssh";

fn account_for(provider: &str) -> String {
    format!("provider:{provider}")
}

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, &account_for(provider)).map_err(|e| e.to_string())
}

fn ssh_account_for(connection_id: &str) -> String {
    format!("connection:{connection_id}")
}

fn ssh_entry(connection_id: &str) -> Result<Entry, String> {
    Entry::new(SSH_SERVICE, &ssh_account_for(connection_id)).map_err(|e| e.to_string())
}

pub fn set_key(provider: &str, key: &str) -> Result<(), String> {
    entry(provider)?
        .set_password(key)
        .map_err(|e| e.to_string())
}

pub fn get_key(provider: &str) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_key(provider: &str) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn has_key(provider: &str) -> bool {
    matches!(get_key(provider), Ok(Some(_)))
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
