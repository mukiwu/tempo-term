use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptKind {
    HostKeyUnknown,
    HostKeyChanged,
    Password,
    Passphrase,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRequest {
    pub id: String,
    pub kind: PromptKind,
    pub message: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptReply {
    pub approved: bool,
    pub secret: Option<String>,
    #[serde(default)]
    pub remember: bool,
}

#[derive(Default)]
pub struct PromptRegistry {
    pending: Mutex<HashMap<String, oneshot::Sender<PromptReply>>>,
}

impl PromptRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, id: &str) -> oneshot::Receiver<PromptReply> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.to_string(), tx);
        rx
    }

    pub fn resolve(&self, id: &str, reply: PromptReply) -> bool {
        if let Some(tx) = self.pending.lock().unwrap().remove(id) {
            tx.send(reply).is_ok()
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolve_completes_a_registered_request() {
        let reg = PromptRegistry::new();
        let rx = reg.register("req-1");
        assert!(reg.resolve("req-1", PromptReply { approved: true, secret: None, remember: false }));
        let reply = rx.await.unwrap();
        assert!(reply.approved);
    }

    #[test]
    fn resolve_unknown_id_returns_false() {
        let reg = PromptRegistry::new();
        assert!(!reg.resolve("nope", PromptReply { approved: false, secret: None, remember: false }));
    }
}
