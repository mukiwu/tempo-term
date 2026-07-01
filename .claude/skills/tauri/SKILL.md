---
name: tauri
description: Use when working with Tauri 2 projects (tauri.conf.json, src-tauri/, capabilities, permissions, #[tauri::command], invoke). Covers commands, IPC, state, plugins, and CSP.
---

# Tauri 2 Application Development

Tauri 2 is a Rust-based framework for building lightweight, secure cross-platform desktop apps with web frontends. This skill covers Tauri 2 specifically (not v1 — APIs differ).

## Quick Reference

| Task | Solution | Notes |
|------|----------|-------|
| Define backend command | `#[tauri::command] async fn name(...)` | Register in `generate_handler!` |
| Call from frontend | `invoke<T>('name', { args })` | Import from `@tauri-apps/api/core` |
| Grant frontend access | Add to `src-tauri/capabilities/*.json` | Permission = `"plugin:command"` |
| Restrict file access | Permission with `allow: [{ path: "$APPDATA/x/*" }]` | Use Tauri path vars, not absolute |
| Manage shared state | `app.manage(Mutex::new(state))` + `State<'_, Mutex<T>>` | Tauri wraps in Arc internally |
| Stream large data | `tauri::ipc::Channel<T>` | Avoids JSON overhead |
| Return binary efficiently | `tauri::ipc::Response::new(bytes)` | Skip serde JSON encoding |
| Custom error type | `thiserror::Error` + manual `Serialize` | Don't return `Result<T, String>` |
| Lock across `.await` | `tokio::sync::Mutex` | `std::sync::Mutex` panics if held across await |
| Add a plugin | `.plugin(tauri_plugin_xxx::init())` in builder | Plus `pnpm add @tauri-apps/plugin-xxx` |
| Strict CSP | `tauri.conf.json > app.security.csp` | Tauri auto-injects nonces for bundled assets |

## Project Structure

```
my-tauri-app/
├── src/                          # Frontend (React/Vue/Svelte/...)
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json           # Main config
│   ├── capabilities/
│   │   └── default.json          # IPC permissions per window
│   ├── permissions/              # Custom permission definitions
│   ├── icons/
│   └── src/
│       ├── main.rs               # Just calls into lib
│       ├── lib.rs                # tauri::Builder setup, generate_handler!
│       └── commands/             # Command modules
└── package.json
```

## Minimal Setup

### `src-tauri/src/lib.rs`

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::save_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### A Command (best practice)

```rust
// src-tauri/src/commands/notes.rs
use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum NoteError {
    #[error("invalid path")]
    InvalidPath,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for NoteError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Default)]
pub struct AppState {
    pub last_saved: Option<String>,
}

#[tauri::command]
pub async fn save_note(
    contents: String,
    state: State<'_, Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<(), NoteError> {
    let dir = app.path().app_data_dir().map_err(|_| NoteError::InvalidPath)?;
    let path = dir.join("note.md");
    tokio::fs::create_dir_all(&dir).await?;
    tokio::fs::write(&path, contents).await?;
    state.lock().await.last_saved = Some(path.to_string_lossy().into_owned());
    Ok(())
}
```

### Frontend Call

```ts
// src/lib/notes.ts
import { invoke } from '@tauri-apps/api/core'

export async function saveNote(contents: string): Promise<void> {
    return invoke<void>('save_note', { contents })
}
```

### Capability JSON

```json
// src-tauri/capabilities/main.json
{
  "identifier": "main",
  "description": "Permissions granted to the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:event:default",
    {
      "identifier": "fs:allow-write-text-file",
      "allow": [{ "path": "$APPDATA/notes/*" }]
    }
  ],
  "platforms": ["macOS", "windows", "linux"]
}
```

## Capability Schema (Official)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `identifier` | string | ✓ | Unique name |
| `permissions` | array | ✓ | `"plugin:command"` strings or scoped objects |
| `description` | string | — | Human-readable purpose |
| `windows` | string[] | — | Window labels; supports glob |
| `webviews` | string[] | — | Webview labels; supports glob |
| `platforms` | string[] | — | `macOS` / `windows` / `linux` / `iOS` / `android` |
| `local` | boolean | — | Default true; for local app URLs |
| `remote.urls` | string[] | — | Allowed remote URL patterns (URLPattern syntax) |

**Security rule**: A window with **no matching capability** has **zero IPC access**. Use this — make new windows opt-in.

## Permission Format

Three forms inside `permissions: []`:

```json
"core:default"                              // simple string
"fs:allow-read-text-file"                   // plugin:command

{                                            // scoped object
  "identifier": "fs:allow-write-text-file",
  "allow": [{ "path": "$APPDATA/notes/*" }],
  "deny": [{ "path": "$APPDATA/notes/secret" }]
}
```

### Tauri Path Variables (use these, not absolute paths)

| Var | Maps to (macOS sandboxed) |
|-----|---------------------------|
| `$APPDATA` | `~/Library/Application Support/<bundle-id>` |
| `$APPCONFIG` | `~/Library/Application Support/<bundle-id>` |
| `$APPCACHE` | `~/Library/Caches/<bundle-id>` |
| `$APPLOG` | `~/Library/Logs/<bundle-id>` |
| `$DOCUMENT` | `~/Documents` (requires user-selected-files entitlement under sandbox) |
| `$HOME` | sandbox container home |
| `$RESOURCE` | bundled resources |

## Custom Permissions

Define reusable permission sets in `src-tauri/permissions/<name>.toml`:

```toml
[[permission]]
identifier = "read-notes"
description = "Read user notes from app data"
commands.allow = ["read_text_file", "read_dir"]

[[scope.allow]]
path = "$APPDATA/notes/*"
```

Then reference in capability: `"permissions": ["fs:read-notes"]`.

## State Management

```rust
// Register
.manage(Mutex::new(AppState::default()))

// Use in command (sync mutex — fine if NOT held across .await)
#[tauri::command]
fn get_count(state: State<'_, std::sync::Mutex<AppState>>) -> u32 {
    state.lock().unwrap().count
}

// Use in async command — MUST be tokio::sync::Mutex if held across .await
#[tauri::command]
async fn save(state: State<'_, tokio::sync::Mutex<AppState>>) -> Result<(), Error> {
    let mut s = state.lock().await;
    do_async_work().await?;
    s.last_saved = Some(now());
    Ok(())
}
```

**Pitfall**: type mismatch between `manage(T)` and `State<'_, U>` causes a runtime panic. Use a type alias.

## Async Commands — Key Rules

- Async runs on Tokio; preferred for I/O
- Cannot use `&str` or `State<'_, T>` directly with naked async — wrap return in `Result<T, E>` (this satisfies the lifetime requirement)
- Use `tokio::fs`, `tokio::sync::*`, never block the runtime

## Streaming with Channel

```rust
use tauri::ipc::Channel;

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
enum DownloadEvent {
    Progress { downloaded: u64, total: u64 },
    Done,
}

#[tauri::command]
async fn download(url: String, on_event: Channel<DownloadEvent>) -> Result<(), Error> {
    // ... fetch
    on_event.send(DownloadEvent::Progress { downloaded: 1024, total: 10240 })?;
    on_event.send(DownloadEvent::Done)?;
    Ok(())
}
```

Frontend:

```ts
import { Channel, invoke } from '@tauri-apps/api/core'
const channel = new Channel<DownloadEvent>()
channel.onmessage = (e) => console.log(e)
await invoke('download', { url: '...', onEvent: channel })
```

## Binary Response (avoid JSON)

```rust
#[tauri::command]
fn read_image(path: String) -> Result<tauri::ipc::Response, Error> {
    let bytes = std::fs::read(path)?;
    Ok(tauri::ipc::Response::new(bytes))
}
```

Frontend gets an `ArrayBuffer` directly — no JSON parse cost.

## CSP — Production-Grade Example

`tauri.conf.json`:

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data:; connect-src 'self' https://api.example.com; font-src 'self' data:"
    }
  }
}
```

Tauri auto-adds nonces for bundled assets. Avoid `unsafe-eval`. If using WASM, add `'wasm-unsafe-eval'` to `script-src`.

## Plugins — Tauri 2 Naming

| v1 | v2 |
|----|-----|
| `@tauri-apps/api/fs` | `@tauri-apps/plugin-fs` |
| `@tauri-apps/api/shell` | `@tauri-apps/plugin-shell` |
| `@tauri-apps/api/dialog` | `@tauri-apps/plugin-dialog` |
| `@tauri-apps/api/tauri` (`invoke`) | `@tauri-apps/api/core` |
| `@tauri-apps/api/notification` | `@tauri-apps/plugin-notification` |
| `@tauri-apps/api/clipboard` | `@tauri-apps/plugin-clipboard-manager` |

## Common Pitfalls (Tauri 2)

1. **Forgot to register command** in `generate_handler!` — frontend gets "command not found"
2. **Multiple `invoke_handler!` calls** — only the last one wins; use a single call
3. **Missing capability** — frontend invoke rejected with permission error
4. **Path var typo** — `$APP_DATA` is wrong; correct is `$APPDATA`
5. **`std::sync::Mutex` across `.await`** — panic at runtime
6. **`unwrap()` in command** — panics propagate to JS as an opaque error
7. **`Result<T, String>`** — works but loses type safety; use `thiserror` enum
8. **Return `Vec<u8>` via JSON** — encodes as base64, slow; use `Response::new(bytes)`
9. **Frontend imports v1 path** — `@tauri-apps/api/tauri` doesn't exist in v2

## Official Documentation Links

| Topic | URL |
|-------|-----|
| Capabilities | https://v2.tauri.app/reference/acl/capability/ |
| Permissions | https://v2.tauri.app/security/permissions/ |
| CSP | https://v2.tauri.app/security/csp/ |
| Calling Rust | https://v2.tauri.app/develop/calling-rust/ |
| State management | https://v2.tauri.app/develop/state-management/ |
