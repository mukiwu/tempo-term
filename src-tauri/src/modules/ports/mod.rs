//! Listening-port monitor shown in the status bar.
//!
//! `listeners::get_all()` maps sockets to owning PIDs cross-platform; it returns
//! TCP+UDP and every socket state, so we filter to TCP + LISTEN. `sysinfo` then
//! fills in per-process metadata (command, cwd, cpu, memory, uptime, user). A
//! long-lived `System` is kept in managed state so cpu deltas are meaningful.

use std::collections::HashSet;
use std::sync::Mutex;

use listeners::{Protocol, SocketState};
use sysinfo::{get_current_pid, Pid, Process, ProcessesToUpdate, System, Uid};
use tauri::State;

/// A TCP listener after filtering, before process metadata is joined in.
#[derive(Clone, PartialEq, Debug)]
pub struct ListenerRow {
    pub port: u16,
    pub bind_addr: String,
    pub pid: u32,
}

/// Per-process metadata pulled from sysinfo, already resolved against the
/// current user so the pure builder stays free of sysinfo types.
pub struct ProcMeta {
    pub name: String,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub cpu_usage: f32,
    pub memory_bytes: u64,
    pub uptime_secs: u64,
    pub is_current_user: bool,
}

#[derive(serde::Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub port: u16,
    pub protocol: String,
    pub bind_addr: String,
    pub pid: u32,
    pub process_name: String,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub cpu_usage: f32,
    pub memory_bytes: u64,
    pub uptime_secs: u64,
    pub is_current_user: bool,
}

/// Collapse rows that share both port and pid (e.g. a process listening on the
/// same port over IPv4 and IPv6) into a single row, keeping the first seen.
pub fn dedupe_by_port_pid(rows: Vec<ListenerRow>) -> Vec<ListenerRow> {
    let mut seen: HashSet<(u16, u32)> = HashSet::new();
    let mut out = Vec::new();
    for r in rows {
        if seen.insert((r.port, r.pid)) {
            out.push(r);
        }
    }
    out
}

/// Join a listener row with optional process metadata. Missing metadata (another
/// user's process, or one we cannot inspect) yields an Unknown row.
pub fn build_port_info(row: ListenerRow, meta: Option<ProcMeta>) -> PortInfo {
    match meta {
        Some(m) => PortInfo {
            port: row.port,
            protocol: "tcp".into(),
            bind_addr: row.bind_addr,
            pid: row.pid,
            process_name: m.name,
            command: m.command,
            cwd: m.cwd,
            cpu_usage: m.cpu_usage,
            memory_bytes: m.memory_bytes,
            uptime_secs: m.uptime_secs,
            is_current_user: m.is_current_user,
        },
        None => PortInfo {
            port: row.port,
            protocol: "tcp".into(),
            bind_addr: row.bind_addr,
            pid: row.pid,
            process_name: "Unknown".into(),
            command: None,
            cwd: None,
            cpu_usage: 0.0,
            memory_bytes: 0,
            uptime_secs: 0,
            is_current_user: false,
        },
    }
}

/// Default view shows only the current user's services; Show all removes the filter.
pub fn should_show(info: &PortInfo, show_all: bool) -> bool {
    show_all || info.is_current_user
}

/// Extract sysinfo process fields into a plain ProcMeta, resolving ownership
/// against the current user's uid. This is the thin untested adapter.
fn extract_meta(process: &Process, own_uid: Option<&Uid>) -> ProcMeta {
    let command = {
        let joined = process
            .cmd()
            .iter()
            .map(|s| s.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ");
        if joined.is_empty() { None } else { Some(joined) }
    };
    let is_current_user = match (process.user_id(), own_uid) {
        (Some(u), Some(o)) => u == o,
        // We can't determine our own uid (common on Windows, where sysinfo often
        // returns None): we have no basis to filter by owner, so don't hide
        // everything — otherwise the default list would be empty. Treat as ours.
        (_, None) => true,
        // We know our uid but the process won't reveal its owner (another user's
        // protected process): keep it out of the current-user default view.
        (None, Some(_)) => false,
    };
    ProcMeta {
        name: process.name().to_string_lossy().into_owned(),
        command,
        cwd: process.cwd().map(|p| p.to_string_lossy().into_owned()),
        cpu_usage: process.cpu_usage(),
        memory_bytes: process.memory(),
        uptime_secs: process.run_time(),
        is_current_user,
    }
}

pub struct PortsState {
    system: Mutex<System>,
}

impl PortsState {
    pub fn new() -> Self {
        Self { system: Mutex::new(System::new()) }
    }
}

impl Default for PortsState {
    fn default() -> Self {
        Self::new()
    }
}

// Async so Tauri runs it off the GUI thread; the listeners + sysinfo reads block.
#[tauri::command]
pub async fn list_ports(
    show_all: bool,
    state: State<'_, PortsState>,
) -> Result<Vec<PortInfo>, String> {
    let all = listeners::get_all().map_err(|e| e.to_string())?;

    let rows: Vec<ListenerRow> = all
        .into_iter()
        .filter(|l| l.protocol == Protocol::TCP && l.state == SocketState::Listen)
        .map(|l| ListenerRow {
            port: l.socket.port(),
            bind_addr: l.socket.ip().to_string(),
            pid: l.process.pid,
        })
        .collect();
    let rows = dedupe_by_port_pid(rows);

    // Refresh ALL processes with remove_dead = true so the long-lived System
    // stays in sync with reality and never accumulates stale entries. Refreshing
    // only the listening pids (Some) would leak: sysinfo only drops dead pids
    // that are part of the update set, so a process that stops listening lingers
    // in the map forever. All + remove_dead keeps the map bounded to live
    // processes (a few hundred, steady), at the cost of a slightly heavier poll.
    let mut sys = state.system.lock().map_err(|e| e.to_string())?;
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let own_uid: Option<Uid> = get_current_pid()
        .ok()
        .and_then(|p| sys.process(p))
        .and_then(|p| p.user_id())
        .cloned();

    let infos: Vec<PortInfo> = rows
        .into_iter()
        .map(|row| {
            let meta = sys
                .process(Pid::from_u32(row.pid))
                .map(|p| extract_meta(p, own_uid.as_ref()));
            build_port_info(row, meta)
        })
        .filter(|info| should_show(info, show_all))
        .collect();

    Ok(infos)
}

#[tauri::command]
pub async fn kill_port_process(
    port: u16,
    pid: u32,
    state: State<'_, PortsState>,
) -> Result<(), String> {
    // Guard against PID reuse: between listing and the user clicking kill, the
    // process could have exited and its pid been recycled by an unrelated one.
    // Confirm the pid still listens on the expected port before killing.
    let still_listening = listeners::get_all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .any(|l| {
            l.protocol == Protocol::TCP
                && l.state == SocketState::Listen
                && l.socket.port() == port
                && l.process.pid == pid
        });
    if !still_listening {
        return Err(format!("Process {pid} is no longer listening on port {port}"));
    }

    let mut sys = state.system.lock().map_err(|e| e.to_string())?;
    let target = Pid::from_u32(pid);
    sys.refresh_processes(ProcessesToUpdate::Some(&[target]), true);
    match sys.process(target) {
        Some(process) => {
            if process.kill() {
                Ok(())
            } else {
                Err(format!("Failed to kill process {pid}"))
            }
        }
        None => Err(format!("Process {pid} not found")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(port: u16, pid: u32) -> ListenerRow {
        ListenerRow { port, bind_addr: "127.0.0.1".into(), pid }
    }

    #[test]
    fn dedupe_collapses_same_port_and_pid() {
        let rows = vec![row(3000, 10), row(3000, 10), row(3000, 11), row(5173, 10)];
        let out = dedupe_by_port_pid(rows);
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn build_port_info_uses_meta_when_present() {
        let meta = ProcMeta {
            name: "node".into(),
            command: Some("node server.js".into()),
            cwd: Some("/work".into()),
            cpu_usage: 1.5,
            memory_bytes: 2048,
            uptime_secs: 90,
            is_current_user: true,
        };
        let info = build_port_info(row(3000, 10), Some(meta));
        assert_eq!(info.process_name, "node");
        assert_eq!(info.command.as_deref(), Some("node server.js"));
        assert_eq!(info.protocol, "tcp");
        assert!(info.is_current_user);
    }

    #[test]
    fn build_port_info_marks_unknown_when_meta_missing() {
        let info = build_port_info(row(7676, 99), None);
        assert_eq!(info.process_name, "Unknown");
        assert_eq!(info.command, None);
        assert_eq!(info.cwd, None);
        assert!(!info.is_current_user);
        assert_eq!(info.port, 7676);
    }

    #[test]
    fn should_show_respects_show_all_and_current_user() {
        let mine = build_port_info(
            row(3000, 10),
            Some(ProcMeta {
                name: "node".into(),
                command: None,
                cwd: None,
                cpu_usage: 0.0,
                memory_bytes: 0,
                uptime_secs: 0,
                is_current_user: true,
            }),
        );
        let other = build_port_info(row(80, 1), None);
        assert!(should_show(&mine, false));
        assert!(!should_show(&other, false));
        assert!(should_show(&other, true));
    }
}
