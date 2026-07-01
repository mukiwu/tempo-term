---
name: tauri-security-review
description: Expert workflow for reviewing Tauri 2 desktop app security. Covers capabilities/permissions least-privilege, IPC trust boundary, command input validation, CSP, scope restriction, isolation pattern, and frontend-side hygiene.
---

# Tauri 2 Security Review Skill

Expert workflow for reviewing Tauri 2 code with a focus on the IPC trust boundary, capability least-privilege, and command-level input validation.

## When to Use

Invoke this skill (or the `tauri-security-reviewer` agent) when changes touch:
- `src-tauri/capabilities/*.json`
- `src-tauri/permissions/*.toml`
- `src-tauri/tauri.conf.json` (security / app / bundle sections)
- Any `#[tauri::command]` function
- `tauri::generate_handler!` registration
- `tauri::Builder` plugin registration
- Frontend `invoke()` callers (especially passing user input)

## Core Principle: Frontend Is Untrusted

The webview is part of the **untrusted** side of the trust boundary. **Every command must validate every input as if it came from a remote attacker.** A capability grants the *ability* to call a command — it does not validate the *contents* of the call.

---

## Checklist by File Type

### Capability Files (`src-tauri/capabilities/*.json`)

```
□ identifier is unique and descriptive
□ windows / webviews are explicitly listed (no broad globs unless justified)
□ permissions list is minimal — every entry has a justified use case
□ fs/shell/http permissions use scoped objects with allow path lists
□ allow paths use Tauri path vars ($APPDATA, etc.), not absolute paths
□ allow paths do NOT use ** wildcards
□ deny rules added for sensitive subpaths (secrets, .env)
□ platforms[] excludes platforms that don't need this capability
□ remote.urls (if present) is a specific allowlist, not "https://*"
□ local: false used when capability is for remote-only contexts
```

### Custom Permission Files (`src-tauri/permissions/*.toml`)

```
□ identifier prefixed with intended namespace
□ commands.allow is the smallest set possible
□ scope.allow paths are specific
□ scope.deny added for any obvious dangerous subpath
□ description explains the security impact, not just the feature
```

### `tauri.conf.json`

```
□ app.security.csp present and restrictive
   - default-src 'self'
   - no 'unsafe-inline' for script-src
   - no 'unsafe-eval' (except 'wasm-unsafe-eval' if WASM is used)
   - connect-src is a specific allowlist
□ app.security.devCsp present (or same as csp) — dev mode shouldn't relax everything
□ app.security.dangerousDisableAssetCspModification is NOT true
□ app.security.assetProtocol.scope is restrictive (not "**")
□ app.windows[].url is local (path) or trusted https — not http or untrusted host
□ build.devUrl is localhost only
□ identifier is reverse-DNS and matches the App Store record
□ plugins.shell.open is restrictive or absent
□ plugins.http.scope (if used) lists exact allowed origins
```

### Rust Commands (`#[tauri::command]`)

```
□ All path inputs validated:
   - canonicalize() to resolve symlinks
   - check that resolved path is inside an expected base dir
   - reject paths containing ".." segments or null bytes
□ Shell-bound inputs never concatenated — use std::process::Command with args[], not args.join(" ")
□ SQL inputs parameterized (never format!())
□ HTTP URLs validated to be in expected origin set
□ Input length bounded — no infinite-size strings/bytes accepted
□ Errors don't leak sensitive paths or stack traces (use a typed error enum that rewrites messages)
□ No unwrap()/expect() — they panic and crash the app
□ Async commands don't hold std::sync::Mutex across .await
□ No use of std::env::set_var (security side effects across threads)
```

### `invoke_handler!` Registration

```
□ Single tauri::generate_handler![...] call (multiple calls silently overwrite)
□ All commands listed actually exist as #[tauri::command]
□ No leftover/dead command registrations exposing unused attack surface
```

### Frontend Callers (`invoke('cmd', { ... })`)

```
□ User input never used as an `invoke` command name (must be a hardcoded string literal)
□ Argument types match the Rust signature exactly
□ Error from invoke is caught and shown safely (not innerHTML'd into DOM — XSS)
```

---

## Common Tauri 2 Security Bug Patterns

### Pattern 1: Over-Broad Capability Scope

```json
// ❌ WRONG — frontend can read/write anywhere in $HOME
{
  "identifier": "main",
  "windows": ["main"],
  "permissions": [
    { "identifier": "fs:allow-write-text-file", "allow": [{ "path": "$HOME/**" }] }
  ]
}

// ✅ CORRECT — narrowly scoped to app data
{
  "identifier": "main",
  "windows": ["main"],
  "permissions": [
    { "identifier": "fs:allow-write-text-file", "allow": [{ "path": "$APPDATA/notes/*" }] }
  ]
}
```

### Pattern 2: Path Traversal in Command

```rust
// ❌ WRONG — frontend can escape with "../../../etc/passwd"
#[tauri::command]
async fn read_note(name: String, app: AppHandle) -> Result<String, NoteError> {
    let dir = app.path().app_data_dir()?;
    let path = dir.join(&name);
    Ok(tokio::fs::read_to_string(&path).await?)
}

// ✅ CORRECT — canonicalize and verify containment
#[tauri::command]
async fn read_note(name: String, app: AppHandle) -> Result<String, NoteError> {
    let dir = app.path().app_data_dir()?.canonicalize()?;
    let path = dir.join(&name).canonicalize()?;
    if !path.starts_with(&dir) {
        return Err(NoteError::InvalidPath);
    }
    Ok(tokio::fs::read_to_string(&path).await?)
}
```

### Pattern 3: Shell Injection via String Concat

```rust
// ❌ WRONG — RCE if `query` contains "; rm -rf ~"
#[tauri::command]
fn search(query: String) -> Result<String, Error> {
    let out = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("grep {} ~/notes", query))
        .output()?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

// ✅ CORRECT — pass args directly, no shell
#[tauri::command]
fn search(query: String) -> Result<String, Error> {
    if query.len() > 200 { return Err(Error::TooLong); }
    let out = std::process::Command::new("grep")
        .arg("--")            // end of options
        .arg(&query)          // safe: passed as argv, no shell parsing
        .arg(notes_dir())
        .output()?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
```

### Pattern 4: Missing Capability — Implicit Trust on a New Window

```rust
// ❌ WRONG — created new window, didn't add capability — but ALSO didn't restrict commands
// New "settings" window can call EVERY command listed in invoke_handler if a wildcard capability exists
let _settings = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings".into()))
    .build()?;

// ✅ CORRECT — explicit capability with minimum permissions for settings window
// src-tauri/capabilities/settings.json
{
  "identifier": "settings",
  "windows": ["settings"],
  "permissions": ["core:default", "settings:allow-read", "settings:allow-write"],
  "platforms": ["macOS"]
}
```

### Pattern 5: CSP Allows Inline Script (XSS Amplifier)

```json
// ❌ WRONG — any reflected XSS becomes RCE via invoke()
"csp": "default-src 'self'; script-src 'self' 'unsafe-inline'"

// ✅ CORRECT — Tauri injects nonces for bundled scripts; no inline needed
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.example.com"
```

### Pattern 6: `dangerousDisableAssetCspModification: true`

```json
// ❌ WRONG — disables Tauri's automatic nonce/hash injection
"app": { "security": { "dangerousDisableAssetCspModification": true } }

// ✅ CORRECT — leave default (false). Only enable if you have a strong CSP without it.
```

### Pattern 7: Untyped Error Leaks Internals

```rust
// ❌ WRONG — full path leaks to frontend (and into logs / crash reports)
#[tauri::command]
fn open_db() -> Result<(), String> {
    std::fs::File::open("/Users/alice/secrets.db").map_err(|e| e.to_string())?;
    Ok(())
}

// ✅ CORRECT — typed error rewrites messages
#[derive(thiserror::Error, Debug)]
enum DbError {
    #[error("database unavailable")]
    Unavailable,
}
impl serde::Serialize for DbError { /* serialize as string */ }
```

### Pattern 8: Remote URL in Window Without Capability Audit

```json
// ❌ WRONG — loading a third-party URL into a window with all permissions
{ "label": "embed", "url": "https://untrusted.example.com/widget" }
// + capability with broad permissions for "embed" window

// ✅ CORRECT — remote content gets a separate capability with NO commands granted
{
  "identifier": "embed-readonly",
  "windows": ["embed"],
  "permissions": ["core:event:default"],  // events only, no fs/shell/etc
  "remote": { "urls": ["https://untrusted.example.com/*"] }
}
```

### Pattern 9: Open URL With User-Controlled String

```rust
// ❌ WRONG — "javascript:..." or arbitrary scheme
#[tauri::command]
fn open_link(url: String, app: AppHandle) {
    app.shell().open(&url, None).ok();
}

// ✅ CORRECT — validate scheme + domain
#[tauri::command]
fn open_link(url: String, app: AppHandle) -> Result<(), Error> {
    let parsed = url::Url::parse(&url).map_err(|_| Error::InvalidUrl)?;
    if !matches!(parsed.scheme(), "https" | "http") { return Err(Error::InvalidScheme); }
    let host = parsed.host_str().ok_or(Error::InvalidUrl)?;
    if !["docs.example.com", "github.com"].contains(&host) { return Err(Error::DomainNotAllowed); }
    app.shell().open(parsed.as_str(), None).map_err(|_| Error::OpenFailed)?;
    Ok(())
}
```

### Pattern 10: Isolation Pattern Not Used For High-Risk IPC

When the app handles secrets (tokens, keys) **and** loads any remote/3rd-party content, enable Tauri's [Isolation Pattern](https://v2.tauri.app/concept/inter-process-communication/isolation/) — it routes all IPC through a sandboxed inner iframe so a compromised main webview cannot forge invoke calls.

---

## Severity Guide

| Severity | Examples | Action |
|----------|----------|--------|
| CRITICAL | Path traversal in command, shell injection, capability with `$HOME/**` write, CSP `unsafe-eval`, command exposed without capability check, secret leaked in error | Block merge |
| HIGH | Over-broad permission scope, missing input validation, `unwrap()` in command, `unsafe-inline` script, http (not https) connect-src | Fix before merge |
| MEDIUM | Missing platforms[] narrowing, missing description, weak error type, asset scope too broad | Fix in follow-up |
| LOW | Identifier naming, missing comments, unused permission entries | Backlog |

---

## Official Documentation References

| Check | Source |
|-------|--------|
| Capability schema | https://v2.tauri.app/reference/acl/capability/ |
| Permission scopes | https://v2.tauri.app/security/permissions/ |
| Security overview | https://v2.tauri.app/security/ |
| CSP | https://v2.tauri.app/security/csp/ |
| Isolation pattern | https://v2.tauri.app/concept/inter-process-communication/isolation/ |
| Calling Rust safely | https://v2.tauri.app/develop/calling-rust/ |

---

## Related

- Agent: `tauri-security-reviewer`
- Commands: `/tauri-review`, `/tauri-check`, `/tauri-audit`
