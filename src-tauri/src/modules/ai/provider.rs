//! Provider-specific request shaping and response parsing for chat
//! completions. Kept pure so the wire format for each provider kind can be
//! unit tested without the network.

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub struct ProviderRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Value,
}

/// Allow https everywhere, and plain http only for loopback hosts so local
/// model servers (Ollama, LM Studio) work without opening an SSRF hole. The
/// base URL is user-supplied for the custom provider, so parse it properly
/// rather than prefix-matching: `http://localhost@evil.com` must not pass as
/// loopback (reqwest sends it — and the Authorization header — to evil.com).
pub fn is_allowed_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    // Embedded credentials let a loopback-looking string resolve to a foreign
    // host; reject them outright.
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    match parsed.scheme() {
        "https" => parsed.host_str().is_some(),
        "http" => match parsed.host_str() {
            Some("localhost") => true,
            Some(host) => {
                // host_str keeps IPv6 in brackets; strip them before parsing.
                let bare = host
                    .strip_prefix('[')
                    .and_then(|h| h.strip_suffix(']'))
                    .unwrap_or(host);
                bare.parse::<std::net::IpAddr>()
                    .map(|ip| ip.is_loopback())
                    .unwrap_or(false)
            }
            None => false,
        },
        _ => false,
    }
}

fn trim_base(base_url: &str) -> &str {
    base_url.trim_end_matches('/')
}

/// Build the HTTP request for a provider kind. `key` is injected from the
/// keychain by the caller.
pub fn build_request(
    kind: &str,
    base_url: &str,
    model: &str,
    messages: &[ChatMessage],
    key: &str,
) -> Result<ProviderRequest, String> {
    let base = trim_base(base_url);
    match kind {
        "openai" => Ok(ProviderRequest {
            url: format!("{base}/chat/completions"),
            // Content-Type is set by reqwest's .json(); adding it here too would
            // send a duplicate header that some APIs reject as malformed.
            headers: vec![("Authorization".to_string(), format!("Bearer {key}"))],
            body: json!({
                "model": model,
                "stream": false,
                "messages": messages
                    .iter()
                    .map(|m| json!({ "role": m.role, "content": m.content }))
                    .collect::<Vec<_>>(),
            }),
        }),
        "anthropic" => {
            let system = messages
                .iter()
                .filter(|m| m.role == "system")
                .map(|m| m.content.clone())
                .collect::<Vec<_>>()
                .join("\n\n");
            let turns = messages
                .iter()
                .filter(|m| m.role != "system")
                .map(|m| json!({ "role": m.role, "content": m.content }))
                .collect::<Vec<_>>();
            Ok(ProviderRequest {
                url: format!("{base}/messages"),
                headers: vec![
                    ("x-api-key".to_string(), key.to_string()),
                    ("anthropic-version".to_string(), "2023-06-01".to_string()),
                ],
                body: json!({
                    "model": model,
                    "max_tokens": 4096,
                    "system": system,
                    "messages": turns,
                }),
            })
        }
        "google" => {
            let contents = messages
                .iter()
                .filter(|m| m.role != "system")
                .map(|m| {
                    let role = if m.role == "assistant" { "model" } else { "user" };
                    json!({ "role": role, "parts": [{ "text": m.content }] })
                })
                .collect::<Vec<_>>();
            let system = messages
                .iter()
                .filter(|m| m.role == "system")
                .map(|m| m.content.clone())
                .collect::<Vec<_>>()
                .join("\n\n");
            Ok(ProviderRequest {
                url: format!("{base}/models/{model}:generateContent?key={key}"),
                headers: vec![],
                body: json!({
                    "contents": contents,
                    "systemInstruction": { "parts": [{ "text": system }] },
                }),
            })
        }
        other => Err(format!("unsupported provider kind: {other}")),
    }
}

/// Extract the assistant text from a provider response payload.
pub fn parse_response(kind: &str, value: &Value) -> Result<String, String> {
    let extracted = match kind {
        "openai" => value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str),
        "anthropic" => value.pointer("/content/0/text").and_then(Value::as_str),
        "google" => value
            .pointer("/candidates/0/content/parts/0/text")
            .and_then(Value::as_str),
        other => return Err(format!("unsupported provider kind: {other}")),
    };

    match extracted {
        Some(text) => Ok(text.to_string()),
        None => {
            // Surface provider error messages when present.
            if let Some(message) = value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .or_else(|| value.pointer("/error").and_then(Value::as_str))
            {
                Err(message.to_string())
            } else {
                Err("could not parse provider response".to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msgs() -> Vec<ChatMessage> {
        vec![
            ChatMessage {
                role: "system".to_string(),
                content: "be terse".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: "hi".to_string(),
            },
        ]
    }

    #[test]
    fn allows_https_and_loopback_http_only() {
        assert!(is_allowed_url("https://api.openai.com/v1"));
        assert!(is_allowed_url("http://localhost:11434/v1"));
        assert!(is_allowed_url("http://127.0.0.1:1234/v1"));
        assert!(is_allowed_url("http://[::1]:1234/v1"));
        assert!(is_allowed_url("http://127.0.0.2:8080/v1")); // 127.0.0.0/8 loopback
        assert!(!is_allowed_url("http://example.com"));
        assert!(!is_allowed_url("ftp://example.com"));
        assert!(!is_allowed_url("https://"));
    }

    #[test]
    fn rejects_loopback_prefix_spoofs() {
        // Substring/prefix tricks that a naive check would wave through.
        assert!(!is_allowed_url("http://localhost.evil.com/v1"));
        assert!(!is_allowed_url("http://127.0.0.1.evil.com/v1"));
        assert!(!is_allowed_url("http://localhost@evil.com/v1"));
        assert!(!is_allowed_url("http://user:pass@localhost/v1"));
        // https with embedded credentials is likewise refused.
        assert!(!is_allowed_url("https://localhost@evil.com/v1"));
    }

    #[test]
    fn loopback_check_is_value_based_not_textual() {
        // Numeric encodings that the URL parser normalizes to 127.0.0.1 must be
        // allowed (reqwest dials the same normalized host), so http loopback
        // detection stays value-based, not textual.
        assert!(is_allowed_url("http://2130706433/v1")); // decimal 127.0.0.1
        assert!(is_allowed_url("http://127.1/v1")); // short form of 127.0.0.1
        // Fail-closed on non-loopback and mapped forms.
        assert!(!is_allowed_url("http://0.0.0.0/v1"));
        assert!(!is_allowed_url("http://[::ffff:127.0.0.1]/v1"));
        assert!(!is_allowed_url("http://localhost./v1")); // trailing dot
    }

    #[test]
    fn openai_request_uses_bearer_auth_and_chat_completions() {
        let req = build_request(
            "openai",
            "https://api.openai.com/v1/",
            "gpt-4o-mini",
            &msgs(),
            "sk-test",
        )
        .unwrap();
        assert_eq!(req.url, "https://api.openai.com/v1/chat/completions");
        assert!(req
            .headers
            .iter()
            .any(|(k, v)| k == "Authorization" && v == "Bearer sk-test"));
        assert_eq!(req.body["messages"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn anthropic_request_splits_system_and_uses_api_key_header() {
        let req = build_request(
            "anthropic",
            "https://api.anthropic.com/v1",
            "claude-x",
            &msgs(),
            "key-1",
        )
        .unwrap();
        assert_eq!(req.url, "https://api.anthropic.com/v1/messages");
        assert_eq!(req.body["system"], "be terse");
        // System message is pulled out, leaving only the user turn.
        assert_eq!(req.body["messages"].as_array().unwrap().len(), 1);
        assert!(req.headers.iter().any(|(k, v)| k == "x-api-key" && v == "key-1"));
    }

    #[test]
    fn google_request_maps_roles_and_puts_key_in_url() {
        let req = build_request(
            "google",
            "https://generativelanguage.googleapis.com/v1beta",
            "gemini-1.5",
            &msgs(),
            "g-key",
        )
        .unwrap();
        assert!(req.url.contains("gemini-1.5:generateContent?key=g-key"));
        assert_eq!(req.body["contents"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn rejects_unknown_provider_kind() {
        assert!(build_request("mystery", "https://x", "m", &msgs(), "k").is_err());
    }

    #[test]
    fn parses_each_provider_response_shape() {
        let openai = json!({"choices":[{"message":{"content":"hello"}}]});
        assert_eq!(parse_response("openai", &openai).unwrap(), "hello");

        let anthropic = json!({"content":[{"text":"hi there"}]});
        assert_eq!(parse_response("anthropic", &anthropic).unwrap(), "hi there");

        let google = json!({"candidates":[{"content":{"parts":[{"text":"yo"}]}}]});
        assert_eq!(parse_response("google", &google).unwrap(), "yo");
    }

    #[test]
    fn surfaces_provider_error_messages() {
        let err = json!({"error":{"message":"invalid api key"}});
        assert_eq!(
            parse_response("openai", &err).unwrap_err(),
            "invalid api key"
        );
    }
}
