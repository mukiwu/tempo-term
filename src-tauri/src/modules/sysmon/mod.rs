//! System metrics (CPU and memory) shown in the status bar.
//!
//! A single long-lived `System` is kept in managed state so CPU usage, which is
//! a delta between refreshes, is meaningful. The frontend polls `system_stats`
//! on an interval; each call refreshes and returns a snapshot.

use std::sync::Mutex;

use sysinfo::System;
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
        let mut system = System::new();
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

#[tauri::command]
pub fn system_stats(state: State<'_, SysinfoState>) -> SystemStats {
    let mut system = state.system.lock().unwrap();
    system.refresh_cpu_usage();
    system.refresh_memory();

    SystemStats {
        cpu_usage: system.global_cpu_usage(),
        ram_used: system.used_memory(),
        ram_total: system.total_memory(),
    }
}
