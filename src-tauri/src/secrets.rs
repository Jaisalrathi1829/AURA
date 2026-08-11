//! Claude API key storage.
//!
//! The key lives in the Windows Credential Manager. It is written from the
//! settings window, read only inside the Rust HTTP client, and never sent to
//! the frontend — callers there can ask *whether* a key exists, nothing more.

use keyring::Entry;

const SERVICE: &str = "com.aura.companion";
const ACCOUNT: &str = "anthropic-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("credential store unavailable: {e}"))
}

pub fn set_api_key(key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return clear_api_key();
    }
    entry()?
        .set_password(key)
        .map_err(|e| format!("could not save key: {e}"))
}

pub fn get_api_key() -> Option<String> {
    let entry = entry().ok()?;
    match entry.get_password() {
        Ok(k) if !k.trim().is_empty() => Some(k),
        _ => None,
    }
}

pub fn has_api_key() -> bool {
    get_api_key().is_some()
}

pub fn clear_api_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        // Deleting a key that was never set is a no-op, not a failure.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("could not clear key: {e}")),
    }
}
