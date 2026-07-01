---
name: tauri-performance-review
description: Expert workflow for reviewing Tauri 2 desktop app performance. Covers IPC payload optimization, async command efficiency, state lock contention, large-data streaming via Channel/Response, frontend bundle size, and startup time.
---

# Tauri 2 Performance Review Skill

Expert workflow for reviewing Tauri 2 code with a focus on IPC throughput, async correctness, and binary/large-payload handling.

## When to Use

Invoke this skill (or the `tauri-performance-reviewer` agent) when changes touch:
- Any `#[tauri::command]` returning or accepting non-trivial data
- Frontend `invoke()` callers (especially in hot paths)
- State management — `Mutex`, `RwLock`, `Arc`
- `tauri.conf.json` build / dev / bundle settings
- `Cargo.toml` features and profiles

## Core Principle: IPC Has Cost

Every `invoke()` round-trip serializes args to JSON, crosses a process boundary, and deserializes the response. **Optimize per call**, then **minimize call count**, then **stream when total bytes are large**.

---

## Checklist by Area

### Rust Commands

```
□ Async fn for I/O work (file, net, db) — never block the runtime
□ Sync fn for pure compute / very fast operations
□ Returns < 100KB use normal serde JSON
□ Returns ≥ 100KB binary use tauri::ipc::Response::new(bytes)
□ Streaming/progress uses tauri::ipc::Channel<T>
□ Inputs aren't Vec<u8> when an ArrayBuffer Request body would work
□ No std::sync::Mutex held across .await (use tokio::sync::Mutex)
□ No .clone() of large Vec/String when a reference works
□ &str arguments instead of String when ownership not needed
□ No JSON parse/stringify inside hot loops
□ Database/HTTP connection pooled (managed state, not per-call)
```

### State Management

```
□ Mutex chosen for the access pattern (sync vs tokio)
□ Read-heavy state uses RwLock, not Mutex
□ Lock scope is minimal — release before slow work
□ No Arc<Mutex<T>> wrapping (Tauri does the Arc internally)
□ No deep clones of state on every read — return references via map_or borrow
```

### Frontend invoke()

```
□ No invoke() in render loops without memoization
□ Multiple sequential invokes that fetch related data → combine into one command
□ Large blob downloads use Channel for progress + Response for bytes
□ Listen for Tauri events instead of polling via invoke
□ No invoke() inside React useEffect without dependency array
```

### tauri.conf.json

```
□ build.frontendDist points to a built (minified) frontend, not dev source
□ bundle.resources only includes what's needed (not entire src/)
□ bundle.macOS.minimumSystemVersion set (avoids fat universal slices for old macOS)
□ app.windows[].visible: false at start if you want to wait for "ready" event (avoids white flash)
□ app.windows[].decorations / transparent set conservatively (each costs paint perf)
□ No huge bundled binaries in externalBin if avoidable
```

### Cargo.toml

```
□ [profile.release] uses opt-level = 3 (default) and lto = "thin" or "fat"
□ codegen-units = 1 in release for max optimization (slower compile, faster binary)
□ strip = true in release (smaller binary)
□ panic = "abort" in release (smaller binary, faster)
□ No unnecessary default features on heavy crates (use default-features = false)
```

### Startup Time

```
□ tauri::Builder::default() doesn't do heavy work in setup (defer to first command)
□ Plugins initialized lazily where the plugin supports it
□ Frontend doesn't fetch all data on mount — paginate
□ Splash window or hidden-then-show pattern for slow initialization
```

---

## Common Tauri 2 Performance Bug Patterns

### Pattern 1: Large Binary Returned As serde JSON

```rust
// ❌ WRONG — 10MB image becomes ~14MB base64 JSON, ~200ms encode + parse
#[tauri::command]
fn read_image(path: String) -> Result<Vec<u8>, Error> {
    Ok(std::fs::read(path)?)
}

// ✅ CORRECT — raw ArrayBuffer, ~10ms
#[tauri::command]
fn read_image(path: String) -> Result<tauri::ipc::Response, Error> {
    Ok(tauri::ipc::Response::new(std::fs::read(path)?))
}
```

Frontend:
```ts
const buf = await invoke<ArrayBuffer>('read_image', { path })
```

### Pattern 2: `std::sync::Mutex` Across `.await` (Panic + Slow)

```rust
// ❌ WRONG — panics in some Tokio configs; serializes async tasks
#[tauri::command]
async fn save(state: State<'_, std::sync::Mutex<AppState>>) -> Result<(), Error> {
    let mut s = state.lock().unwrap();    // sync lock
    tokio::fs::write("...", &s.buf).await?;  // held across .await
    Ok(())
}

// ✅ CORRECT — use tokio's async mutex
#[tauri::command]
async fn save(state: State<'_, tokio::sync::Mutex<AppState>>) -> Result<(), Error> {
    let mut s = state.lock().await;
    tokio::fs::write("...", &s.buf).await?;
    Ok(())
}
```

### Pattern 3: Polling Instead of Events

```ts
// ❌ WRONG — invoke every 500ms, wakes the UI thread + Rust constantly
setInterval(async () => {
    setStatus(await invoke<Status>('get_status'))
}, 500)

// ✅ CORRECT — emit from Rust, listen from frontend
import { listen } from '@tauri-apps/api/event'
const un = await listen<Status>('status:changed', (e) => setStatus(e.payload))
```

```rust
app.emit("status:changed", status)?;
```

### Pattern 4: Streaming Without Channel

```rust
// ❌ WRONG — caller waits 30s for download; no progress UI possible
#[tauri::command]
async fn download(url: String) -> Result<Vec<u8>, Error> {
    Ok(reqwest::get(&url).await?.bytes().await?.to_vec())
}

// ✅ CORRECT — Channel sends progress + chunks
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
enum DownloadEvent {
    Progress { downloaded: u64, total: u64 },
    Chunk(Vec<u8>),
    Done,
}

#[tauri::command]
async fn download(url: String, on_event: Channel<DownloadEvent>) -> Result<(), Error> {
    let resp = reqwest::get(&url).await?;
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        downloaded += chunk.len() as u64;
        on_event.send(DownloadEvent::Progress { downloaded, total })?;
        on_event.send(DownloadEvent::Chunk(chunk.to_vec()))?;
    }
    on_event.send(DownloadEvent::Done)?;
    Ok(())
}
```

### Pattern 5: N+1 Invoke Calls

```ts
// ❌ WRONG — 50 round-trips for 50 notes
const notes: Note[] = []
for (const id of ids) {
    notes.push(await invoke<Note>('get_note', { id }))
}

// ✅ CORRECT — one round-trip
const notes = await invoke<Note[]>('get_notes', { ids })
```

### Pattern 6: Mutex Held While Doing Work

```rust
// ❌ WRONG — lock held while writing 100MB to disk; blocks all readers
let mut s = state.lock().await;
tokio::fs::write(&path, &s.huge_buffer).await?;  // 2 seconds
s.last_saved = Some(now());
drop(s);

// ✅ CORRECT — clone what's needed, release lock immediately
let buffer = {
    let s = state.lock().await;
    s.huge_buffer.clone()
};
tokio::fs::write(&path, &buffer).await?;
state.lock().await.last_saved = Some(now());
```

### Pattern 7: Heavy Work in `.setup()` Blocks Window Show

```rust
// ❌ WRONG — DB load on startup adds 3s to first paint
.setup(|app| {
    let db = load_database_sync()?;   // blocks
    app.manage(db);
    Ok(())
})

// ✅ CORRECT — initialize lazily, show window first
.setup(|app| {
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let db = load_database().await.unwrap();
        handle.manage(db);
        handle.emit("db:ready", ()).ok();
    });
    Ok(())
})
```

### Pattern 8: Cargo Release Profile Not Tuned

```toml
# ❌ Default — 80MB binary
[profile.release]
opt-level = 3

# ✅ Tuned for ship-quality binary — typically 25-40MB
[profile.release]
opt-level = "z"      # or "s" for size
lto = true
codegen-units = 1
panic = "abort"
strip = true
```

### Pattern 9: Frontend Bundles Dev Dependencies

```json
// ❌ WRONG — frontendDist points at unminified source
"build": { "frontendDist": "../src" }

// ✅ CORRECT — point at production build output
"build": {
  "beforeBuildCommand": "pnpm build",
  "frontendDist": "../dist"
}
```

### Pattern 10: `.clone()` On Large `State` Read

```rust
// ❌ WRONG — clones a 10MB Vec on every read
#[tauri::command]
fn get_buffer(state: State<'_, Mutex<AppState>>) -> Vec<u8> {
    state.lock().unwrap().buffer.clone()
}

// ✅ CORRECT — return Response (raw bytes), no JSON, single copy
#[tauri::command]
fn get_buffer(state: State<'_, Mutex<AppState>>) -> tauri::ipc::Response {
    tauri::ipc::Response::new(state.lock().unwrap().buffer.clone())
}
// Or even better: use Bytes/Arc<[u8]> in state to avoid the clone entirely
```

---

## Severity Guide

| Severity | Examples | Action |
|----------|----------|--------|
| CRITICAL | std::sync::Mutex across .await (panic risk), 100MB+ JSON returns, polling at <1s interval, blocking I/O in async command | Block merge |
| HIGH | Channel not used for streaming, N+1 invoke pattern, large clone() in hot path, lock held across slow work | Fix before merge |
| MEDIUM | Missing release profile tuning, missing minimumSystemVersion, suboptimal Mutex choice for read-heavy state | Follow-up |
| LOW | Stylistic, micro-opts in cold paths | Backlog |

---

## Official Documentation References

| Check | Source |
|-------|--------|
| Calling Rust (commands, Channel, Response) | https://v2.tauri.app/develop/calling-rust/ |
| State management | https://v2.tauri.app/develop/state-management/ |
| Bundle / config | https://v2.tauri.app/reference/config/ |

---

## Related

- Agent: `tauri-performance-reviewer`
- Commands: `/tauri-perf`, `/tauri-check`, `/tauri-audit`
