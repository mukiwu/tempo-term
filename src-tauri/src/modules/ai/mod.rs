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
    if model.trim().is_empty() {
        return Err("No model selected — choose or type a model in the chat header.".to_string());
    }

    // Apple Intelligence is not an HTTP provider: no key, no URL, the whole
    // exchange stays on-device via FoundationModels.
    if kind == "apple" {
        return apple_chat(messages).await;
    }

    let key = secrets::get_key(&provider)?.unwrap_or_default();
    let request = build_request(&kind, &base_url, &model, &messages, &key)?;

    if !is_allowed_url(&request.url) {
        return Err(format!("request URL is not permitted: {}", request.url));
    }

    // No redirects: is_allowed_url only vets the first hop, so a redirect could
    // send the request (and, for a non-custom provider, its key) to a host the
    // loopback/https policy never approved. This proxy only ever talks to one
    // API root, so following redirects is never legitimate anyway.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut builder = client.post(&request.url).json(&request.body);
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }

    let response = builder.send().await.map_err(|e| e.to_string())?;
    let value: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    parse_response(&kind, &value)
}

/// Whether the on-device Apple Intelligence model can serve as a provider.
#[tauri::command]
pub async fn ai_apple_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            fm_rs::SystemLanguageModel::new()
                .map(|m| m.is_available())
                .unwrap_or(false)
        })
        .await
        .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
async fn apple_chat(messages: Vec<ChatMessage>) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let model = fm_rs::SystemLanguageModel::new().map_err(|e| e.to_string())?;
            if !model.is_available() {
                return Err("Apple Intelligence is not available on this Mac.".to_string());
            }
            let (instructions, prompt) = build_apple_parts(&messages);
            let session = if instructions.is_empty() {
                fm_rs::Session::new(&model)
            } else {
                fm_rs::Session::with_instructions(&model, &instructions)
            }
            .map_err(|e| e.to_string())?;
            let response = session
                .respond(&prompt, &fm_rs::GenerationOptions::default())
                .map_err(|e| e.to_string())?;
            Ok(response.content().to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Apple Intelligence is only available on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
use provider::apple_prompt_parts as build_apple_parts;
