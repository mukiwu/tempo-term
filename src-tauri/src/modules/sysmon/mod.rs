//! System metrics (CPU and memory) shown in the status bar.
//!
//! A single long-lived `System` is kept in managed state so CPU usage, which is
//! a delta between refreshes, is meaningful. The frontend polls `system_stats`
//! on an interval; each call refreshes and returns a snapshot.

use std::sync::Mutex;

use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
use tauri::State;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    /// Global CPU usage across all cores, 0–100.
    cpu_usage: f32,
    ram_used: u64,
    ram_total: u64,
}

pub struct SysinfoState {
    system: Mutex<System>,
}

impl SysinfoState {
    pub fn new() -> Self {
        // `System::new()` enables no refresh kinds, so the CPU list stays empty
        // and global_cpu_usage() would always read 0. Enable CPU usage and RAM
        // explicitly so the metrics are populated.
        let mut system = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
                .with_memory(MemoryRefreshKind::nothing().with_ram()),
        );
        // Prime CPU + memory so the first poll already has a baseline to diff.
        system.refresh_cpu_usage();
        system.refresh_memory();
        SysinfoState {
            system: Mutex::new(system),
        }
    }
}

impl Default for SysinfoState {
    fn default() -> Self {
        Self::new()
    }
}

// Async so Tauri runs it on its worker pool rather than the main GUI thread;
// the refresh calls do blocking system reads. An async command borrowing State
// must return a Result. No `.await` is held across the lock, so the guard never
// crosses a suspension point.
#[tauri::command]
pub async fn system_stats(state: State<'_, SysinfoState>) -> Result<SystemStats, String> {
    let mut system = state.system.lock().map_err(|e| e.to_string())?;
    system.refresh_cpu_usage();
    system.refresh_memory();

    Ok(SystemStats {
        cpu_usage: system.global_cpu_usage(),
        ram_used: system.used_memory(),
        ram_total: system.total_memory(),
    })
}
