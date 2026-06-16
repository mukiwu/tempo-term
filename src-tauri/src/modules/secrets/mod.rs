//! Secure storage for provider API keys via the OS keychain (keyring crate).
//! Keys are written and cleared from the frontend, but only read inside the
//! backend (the ai module) so they never travel back to the webview.

use keyring::Entry;

const SERVICE: &str = "tempoterm-ai";

fn account_for(provider: &str) -> String {
    format!("provider:{provider}")
}

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, &account_for(provider)).map_err(|e| e.to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_name_is_namespaced_per_provider() {
        assert_eq!(account_for("openai"), "provider:openai");
        assert_eq!(account_for("anthropic"), "provider:anthropic");
        assert_ne!(account_for("openai"), account_for("anthropic"));
    }
}
