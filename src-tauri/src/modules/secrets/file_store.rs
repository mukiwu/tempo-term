//! Local encrypted store for cloud API keys (AI provider keys + GitHub token).
//! Values are sealed with a machine-bound key so the on-disk file does not
//! decrypt on another machine. The account name stays in clear; only the
//! secret value is encrypted.

use std::collections::BTreeMap;
use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use orion::aead::{self, SecretKey};
use serde::{Deserialize, Serialize};

const VERSION: u32 = 1;

/// On-disk shape: account names in clear, each value a base64 sealed blob.
#[derive(Serialize, Deserialize, Default)]
struct Store {
    version: u32,
    entries: BTreeMap<String, String>,
}

/// Load the store, treating a missing, unreadable, or malformed file as empty
/// so a corrupt file degrades to "no keys" rather than a hard failure.
fn read_store(path: &Path) -> Store {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Store::default(),
    }
}

fn write_store(path: &Path, store: &Store) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(path, &json).map_err(|e| e.to_string())?;
    restrict_permissions(path)
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub fn set(path: &Path, key: &SecretKey, account: &str, value: &str) -> Result<(), String> {
    let sealed = aead::seal(key, value.as_bytes()).map_err(|e| e.to_string())?;
    let mut store = read_store(path);
    store.version = VERSION;
    store.entries.insert(account.to_string(), STANDARD.encode(sealed));
    write_store(path, &store)
}

/// Remove an entry. Decryption is not needed to drop a key, so no `SecretKey`
/// is required. A missing account is a no-op.
pub fn delete(path: &Path, account: &str) -> Result<(), String> {
    let mut store = read_store(path);
    if store.entries.remove(account).is_some() {
        store.version = VERSION;
        write_store(path, &store)?;
    }
    Ok(())
}

pub fn get(path: &Path, key: &SecretKey, account: &str) -> Result<Option<String>, String> {
    let store = read_store(path);
    let Some(encoded) = store.entries.get(account) else {
        return Ok(None);
    };
    // A decode/open/utf8 failure (wrong key, corrupted entry) is treated as
    // absent so the user can re-enter and overwrite.
    let Ok(blob) = STANDARD.decode(encoded) else {
        return Ok(None);
    };
    let Ok(plain) = aead::open(key, &blob) else {
        return Ok(None);
    };
    Ok(String::from_utf8(plain).ok())
}

pub fn has(path: &Path, key: &SecretKey, account: &str) -> bool {
    matches!(get(path, key, account), Ok(Some(_)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_path() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("tt_secrets_test_{}_{}.enc", std::process::id(), n))
    }

    fn test_key() -> SecretKey {
        SecretKey::from_slice(&[7u8; 32]).unwrap()
    }

    #[test]
    fn set_then_get_returns_value() {
        let path = temp_path();
        let key = test_key();
        set(&path, &key, "provider:openai", "sk-secret-123").unwrap();
        let got = get(&path, &key, "provider:openai").unwrap();
        assert_eq!(got, Some("sk-secret-123".to_string()));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_unknown_account_returns_none() {
        let path = temp_path();
        let key = test_key();
        assert_eq!(get(&path, &key, "provider:nope").unwrap(), None);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn delete_removes_entry() {
        let path = temp_path();
        let key = test_key();
        set(&path, &key, "github", "ghp_token").unwrap();
        delete(&path, "github").unwrap();
        assert_eq!(get(&path, &key, "github").unwrap(), None);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn has_reflects_presence_and_absence() {
        let path = temp_path();
        let key = test_key();
        assert!(!has(&path, &key, "provider:openai"));
        set(&path, &key, "provider:openai", "sk-x").unwrap();
        assert!(has(&path, &key, "provider:openai"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn on_disk_file_does_not_contain_plaintext() {
        let path = temp_path();
        let key = test_key();
        let secret = "sk-super-secret-value-9876";
        set(&path, &key, "provider:openai", secret).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert!(
            !bytes.windows(secret.len()).any(|w| w == secret.as_bytes()),
            "plaintext secret leaked into the file"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn different_key_cannot_open_entries() {
        let path = temp_path();
        let key_a = SecretKey::from_slice(&[1u8; 32]).unwrap();
        let key_b = SecretKey::from_slice(&[2u8; 32]).unwrap();
        set(&path, &key_a, "provider:openai", "sk-x").unwrap();
        // Wrong key (another machine) decrypts to nothing: treated as absent.
        assert_eq!(get(&path, &key_b, "provider:openai").unwrap(), None);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn multiple_accounts_coexist() {
        let path = temp_path();
        let key = test_key();
        set(&path, &key, "provider:openai", "sk-openai").unwrap();
        set(&path, &key, "github", "ghp_token").unwrap();
        delete(&path, "provider:openai").unwrap();
        assert_eq!(get(&path, &key, "provider:openai").unwrap(), None);
        assert_eq!(get(&path, &key, "github").unwrap(), Some("ghp_token".to_string()));
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(unix)]
    #[test]
    fn file_is_created_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let path = temp_path();
        let key = test_key();
        set(&path, &key, "github", "ghp_token").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let _ = std::fs::remove_file(&path);
    }
}
