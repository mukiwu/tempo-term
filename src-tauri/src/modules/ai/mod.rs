//! AI chat module: proxies chat-completion requests so API keys stay in the
//! backend keychain and provider calls are not blocked by the webview's CORS
//! policy.

mod provider;

pub use provider::ChatMessage;

use crate::modules::secrets;
use provider::{build_request, is_allowed_url, parse_response};

/// Send a chat request to a provider and return the assistant's reply text.
///
/// `provider` is the keychain account id; `kind` is the wire protocol
/// ("openai", "anthropic" or "google"); `base_url` is the API root.
#[tauri::command]
pub async fn ai_chat(
    provider: String,
    kind: String,
    base_url: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let key = secrets::get_key(&provider)?.unwrap_or_default();
    let request = build_request(&kind, &base_url, &model, &messages, &key)?;

    if !is_allowed_url(&request.url) {
        return Err(format!("request URL is not permitted: {}", request.url));
    }

    let client = reqwest::Client::new();
    let mut builder = client.post(&request.url).json(&request.body);
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }

    let response = builder.send().await.map_err(|e| e.to_string())?;
    let value: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    parse_response(&kind, &value)
}
