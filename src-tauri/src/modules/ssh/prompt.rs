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

    /// Drop a single pending prompt by id. Used by `request_prompt`'s cleanup
    /// guard so a prompt whose future is dropped (cancelled, emit failed) does
    /// not linger in the map until the coarser per-session sweep runs.
    pub fn remove(&self, id: &str) {
        self.pending.lock().unwrap().remove(id);
    }

    /// Remove every pending prompt whose id starts with `"{session_id}-"`.
    /// The hyphen suffix prevents session 1 from accidentally matching session 12.
    pub fn discard_session(&self, session_id: u32) {
        let prefix = format!("{session_id}-");
        self.pending
            .lock()
            .unwrap()
            .retain(|id, _| !id.starts_with(&prefix));
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

    #[test]
    fn discard_session_removes_all_entries_for_that_session() {
        let reg = PromptRegistry::new();
        reg.register("1-hostkey");
        reg.register("1-password");
        reg.discard_session(1);
        assert!(!reg.resolve("1-hostkey", PromptReply { approved: false, secret: None, remember: false }));
        assert!(!reg.resolve("1-password", PromptReply { approved: false, secret: None, remember: false }));
    }

    #[test]
    fn discard_session_does_not_remove_other_sessions() {
        let reg = PromptRegistry::new();
        reg.register("1-hostkey");
        let _rx12 = reg.register("12-hostkey");
        reg.discard_session(1);
        // session 1 gone
        assert!(!reg.resolve("1-hostkey", PromptReply { approved: false, secret: None, remember: false }));
        // session 12 still there (prefix "12-" does not start with "1-")
        assert!(reg.resolve("12-hostkey", PromptReply { approved: true, secret: None, remember: false }));
    }
}
