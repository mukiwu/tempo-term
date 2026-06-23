//! SSH session manager — real SshState + stub command bodies.
//! Tasks 6–8 replace the stubs with real async SSH logic.

use std::sync::Arc;

use tauri::{AppHandle, State};
use tauri::ipc::{Channel, Response};

use super::prompt::{PromptRegistry, PromptReply};
use super::SshOpenRequest;

/// Manages all active SSH sessions and the shared prompt registry.
/// Registered as Tauri managed state so every command can access it.
pub struct SshState {
    pub(crate) registry: Arc<PromptRegistry>,
}

impl SshState {
    pub fn new() -> Self {
        Self {
            registry: Arc::new(PromptRegistry::new()),
        }
    }

    /// Forward a prompt reply to the waiting async task.
    /// Returns `true` if a pending prompt was found and resolved.
    pub fn resolve_prompt(&self, id: &str, reply: PromptReply) -> bool {
        self.registry.resolve(id, reply)
    }
}

// ---------------------------------------------------------------------------
// Stub implementations — Task 8 fills these in with real async logic.
// ---------------------------------------------------------------------------

pub fn open(
    _app: &AppHandle,
    _state: &State<'_, SshState>,
    _req: SshOpenRequest,
    _on_data: Channel<Response>,
    _on_exit: Channel<i32>,
) -> Result<u32, String> {
    Err("ssh not implemented yet".into())
}

pub fn write_input(
    _state: &State<'_, SshState>,
    _id: u32,
    _data: Vec<u8>,
) -> Result<(), String> {
    Err("ssh not implemented yet".into())
}

pub fn resize(
    _state: &State<'_, SshState>,
    _id: u32,
    _cols: u16,
    _rows: u16,
) -> Result<(), String> {
    Err("ssh not implemented yet".into())
}

pub fn close(_state: &State<'_, SshState>, _id: u32) {
    // no-op stub
}
