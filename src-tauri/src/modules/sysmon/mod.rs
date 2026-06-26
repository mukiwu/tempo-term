//! System metrics (CPU, memory, network rates) shown in the status bar.
//!
//! A single long-lived `System` + `Networks` is kept in managed state so the
//! per-refresh deltas (CPU usage and bytes-since-last-refresh) are meaningful.
//! The frontend polls `system_stats` on an interval; each call refreshes and
//! returns a snapshot.

use std::sync::Mutex;
use std::time::Instant;

use sysinfo::{CpuRefreshKind, MemoryRefreshKind, Networks, RefreshKind, System};
use tauri::State;

/// Loopback interfaces are excluded from the network totals so the status bar
/// reflects real traffic, not local socket chatter.
fn is_loopback(name: &str) -> bool {
    name == "lo" || name == "lo0" || name.starts_with("lo:")
}

/// Convert a byte delta over `elapsed_secs` into a whole bytes-per-second rate.
fn per_second(bytes: u64, elapsed_secs: f64) -> u64 {
    if elapsed_secs <= 0.0 {
        return 0;
    }
    (bytes as f64 / elapsed_secs) as u64
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    /// Global CPU usage across all cores, 0–100.
    cpu_usage: f32,
    ram_used: u64,
    ram_total: u64,
    /// Receive / transmit rates in bytes per second since the previous poll.
    net_rx: u64,
    net_tx: u64,
}

struct SysInner {
    system: System,
    networks: Networks,
    last: Instant,
}

pub struct SysinfoState {
    inner: Mutex<SysInner>,
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
            inner: Mutex::new(SysInner {
                system,
                networks: Networks::new_with_refreshed_list(),
                last: Instant::now(),
            }),
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
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    inner.system.refresh_cpu_usage();
    inner.system.refresh_memory();
    inner.networks.refresh(true);

    let now = Instant::now();
    let elapsed = now.duration_since(inner.last).as_secs_f64();
    inner.last = now;

    let mut rx_total: u64 = 0;
    let mut tx_total: u64 = 0;
    for (name, data) in inner.networks.iter() {
        if is_loopback(name) {
            continue;
        }
        rx_total += data.received();
        tx_total += data.transmitted();
    }

    Ok(SystemStats {
        cpu_usage: inner.system.global_cpu_usage(),
        ram_used: inner.system.used_memory(),
        ram_total: inner.system.total_memory(),
        net_rx: per_second(rx_total, elapsed),
        net_tx: per_second(tx_total, elapsed),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_loopback_interfaces() {
        assert!(is_loopback("lo"));
        assert!(is_loopback("lo0"));
        assert!(!is_loopback("en0"));
        assert!(!is_loopback("eth0"));
        assert!(!is_loopback("wlan0"));
    }

    #[test]
    fn per_second_divides_by_elapsed() {
        assert_eq!(per_second(2048, 2.0), 1024);
        assert_eq!(per_second(1500, 1.0), 1500);
    }

    #[test]
    fn per_second_guards_against_zero_elapsed() {
        assert_eq!(per_second(1024, 0.0), 0);
    }
}
