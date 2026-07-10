---
name: windows-tauri
description: Use when writing or reviewing code in this Tauri app that can behave differently on Windows — spawning a subprocess (git/gh/any Command), path handling, cfg-gated platform APIs, the pty/terminal, clipboard, ssh, line endings, or a new native crate — and before cutting a release. The dev box is macOS, so Windows regressions do not surface locally; they only show in the Windows CI build or on a user's machine. Encodes the Windows pitfalls this repo has actually shipped and fixed.
---

# Windows × Tauri guardrails (tempo-term)

Development happens on macOS. Two GitHub Actions cover Windows: `.github/workflows/windows-check.yml` runs `cargo check` with warnings-as-errors on a `windows-latest` runner for **every PR and push to master** (added in #191), and `.github/workflows/windows-build.yml` builds the actual bundle only on a `v*` tag (or manual dispatch). So a *compile or warning* regression now fails the PR that caused it; but a *runtime, bundle, or behavior* bug still compiles clean and only surfaces in the tagged Windows build or on a user's machine. Historically there was no per-PR gate at all — which is why every Windows bug in this repo's history before #191 reached a release.

This skill is the checklist that closes the remaining gap: everything `cargo check` cannot see. Read it before touching any of the surfaces below, and run the pre-flight list before a release.

## Pre-flight checklist

Apply while writing, not after. Each line links to the detailed rule.

- [ ] **Spawning a process?** Set `CREATE_NO_WINDOW` on Windows, or a console flashes and each call costs ~100ms in a release build. [→](#1-every-subprocess-spawn-needs-create_no_window)
- [ ] **Resolving an executable on disk?** Windows binaries are `gh.exe`/`.cmd`/`.bat`, home is `USERPROFILE`, install dirs differ. [→](#2-executable-resolution-differs-on-windows)
- [ ] **A subprocess with no timeout?** A hung `gh`/`git` blocks the caller thread forever; add a timeout. [→](#3-give-external-commands-a-timeout)
- [ ] **Injecting a command into a pty?** Terminate with `\r`, not `\n`, or ConPTY leaves it on a `>>` continuation line. [→](#4-inject-pty-commands-with-cr-not-lf)
- [ ] **Building a path that bash will run?** Use forward slashes; never inject a bare `.sh`; quote Windows paths with double quotes. [→](#5-paths-forward-slashes-for-bash-double-quotes-for-shells)
- [ ] **A `#[cfg(unix)]` API, a cfg-split command, or a new native crate?** It must compile **warning-free** on Windows — `windows-check.yml` runs `cargo check` with `-D warnings` per PR. Provide a Windows arm or cfg-gate cleanly, and `allow(dead_code)`/`allow(unused_variables)` the mac-only bits. [→](#6-unix-only-apis-and-native-crates-must-still-build-on-windows)
- [ ] **Reaching into `/proc`, `lsof`, a unix socket, pty foreground?** No Windows backend exists; skip the feature there or return a clean `None`. [→](#7-no-windows-backend-skip-do-not-crash-or-spin)
- [ ] **Frontend behavior gated on platform?** Route Windows through `IS_WINDOWS`, do not leave it `IS_MAC`-only. [→](#8-frontend-gate-on-is_windows-not-just-is_mac)
- [ ] **Release?** `windows-build.yml` is the bundle/link gate (per-PR `cargo check` already covered compile); `latest.json` notes get re-patched; functional test on a real Windows host. [→](#release-checklist-windows)

## Failure catalog (what this repo has actually hit)

| Symptom on Windows | Root cause | Rule | Shipped fix |
|---|---|---|---|
| Black console flashes on every git/gh call; UI stalls | Release build owns no console (`windows_subsystem = "windows"`); a spawn without `CREATE_NO_WINDOW` allocates one | Set `CREATE_NO_WINDOW` on every `Command` | #82, #105 |
| "PATH 上找不到 gh CLI" although `gh` is installed | Searched for bare `gh`; Windows binary is `gh.exe`; used `HOME` and macOS install dirs | Append `.exe`/`.cmd`/`.bat`, use `USERPROFILE`, Windows install dirs | #89 |
| Launcher command sits under a `>>` prompt, never runs | ConPTY/PSReadLine binds CR to submit, LF to continuation; we injected LF | Terminate injected commands with `\r` | #160 |
| Status hook never fires / spams "Open With" dialog | bash escapes `\`; a bare `.sh` under cmd triggers ShellExecute picker | Forward-slash paths; do not inject a bare `.sh` on Windows | #76, #155 (open) |
| `cargo build` fails on a stock Windows box | `aws-lc-sys` (via russh default `aws-lc-rs`) needs NASM | Use russh `ring` backend | #75 |
| Windows release fails to compile (E0599) once SSH landed | `AgentClient::connect_env` is `#[cfg(unix)]` | Windows arm: `connect_named_pipe` / `connect_pageant` | #52, #54 |
| Windows warns `unused variable` / `dead_code`, then fails under `-D warnings` | A cfg-split command's structs/params are only read in the `#[cfg(target_os = "macos")]` arm; the Windows arm is a no-op stub | `#[cfg_attr(not(target_os = "macos"), allow(dead_code))]` on the model, `allow(unused_variables)` on the fn | #190, gated #191 |
| Terminal paste does nothing | Native paste suppressed everywhere; smart-paste mac-only; backend empty off mac | Route `Ctrl+V` via `IS_WINDOWS`; read clipboard with `clipboard-win` | #75 |
| cwd tracking dead / 1.2s poll fires empty IPC every terminal | `pty_cwd` has no Windows backend (`/proc`, `lsof` absent) | Skip the poll on Windows, or use OSC 7 shell integration | #105, #115 |
| Updater "更新內容" dialog empty after a release | Windows CI `tauri-action` rewrites `latest.json` and wipes `notes` | Re-patch notes post-build from `CHANGELOG-NEXT.md` | #43 |
| Diff-open lag only in the release build | Same console-flash spawn cost, per git subprocess | `CREATE_NO_WINDOW` (see row 1) | #82 |

---

## 1. Every subprocess spawn needs `CREATE_NO_WINDOW`

A release build sets `windows_subsystem = "windows"` (`src-tauri/src/main.rs:2`) and owns no console, so Windows allocates a fresh console for every child process spawned without the flag: a visible window flash plus ~100ms per call. `tauri dev` owns a console, so this **never reproduces in dev** — only in a release build or on a user's machine.

Copy the established helper shape (`src-tauri/src/modules/git/mod.rs:545`, `src-tauri/src/modules/pr/mod.rs:185`):

```rust
use std::process::Command;

fn spawn_thing(exe: &str) -> Command {
    let mut command = Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}
```

Rule: **any** new `Command` that shells out (git, gh, a formatter, anything) routes through a helper that sets this flag. A no-op on Unix and on debug builds; mandatory in the Windows release.

## 2. Executable resolution differs on Windows

`find_gh()` searched for a file literally named `gh`; on Windows the binary is `gh.exe`, so it never matched (#89). Three separate assumptions break:

- **Extension**: probe `gh`, then `gh.exe`, `gh.cmd`, `gh.bat` on Windows. See `exe_names()` in `src-tauri/src/modules/pr/mod.rs`.
- **Home var**: Windows usually has no `HOME`; fall back to `USERPROFILE`.
- **Install dirs**: not `/opt/homebrew/bin`; use `Program Files\GitHub CLI`, chocolatey, scoop shims.

Parameterize the platform (`windows: bool`) so both arms are unit-testable on the mac CI runner, rather than hiding the Windows path behind `#[cfg]` where it never gets exercised locally.

## 3. Give external commands a timeout

`Command::output()` has no timeout. A hung `gh` (network stall, an interactive auth prompt) blocks the calling thread forever, and on a poll timer those pile up (#105). Wrap spawns that can hang with a timeout (this repo uses the `wait-timeout` crate — see `run_gh` in `src-tauri/src/modules/pr/mod.rs`, 5s kill).

## 4. Inject pty commands with CR, not LF

On Windows ConPTY, PSReadLine binds **CR (`\r`) to `AcceptLine`** (submit) and **LF (`\n`) to `AddLine`** (a `>>` continuation line). An injected `\n` never runs the command (#160). macOS/Linux tolerate `\n` only because the pty line discipline (`ICRNL`) maps CR→LF on input, hiding the bug.

Rule: any code that auto-types a command into a pane (`runCommandInTerminal`, launcher command injection) terminates with `\r`. CR is what a real Enter key sends and what xterm emits, so it submits on all three platforms.

## 5. Paths: forward slashes for bash, double quotes for shells

- **bash escapes `\`.** A Windows backslash path handed to anything Claude Code / git-bash runs collapses (`C:\Users\...` → `C:Users...`). Store and compare paths in a single forward-slash form; git-bash accepts them. See `normalize()` in `src-tauri/src/modules/claude_status_hook/mod.rs`.
- **Never inject a bare `.sh` command on Windows.** cmd cannot execute a `.sh` path and pops the "Open With" picker on every hook event (#155, still open). If a shell script must run, name the interpreter explicitly (`bash -c "..."` / the git-bash `bash.exe`), or ship a `.cmd`/`.ps1`/native shim.
- **Quote paths with double quotes**, accepted by cmd, PowerShell, and git-bash. POSIX single quotes are wrong on Windows (#75).

## 6. Unix-only APIs and native crates must still build on Windows

The dev box **cannot cross-compile** the Windows bundle — `git2`, `font-kit`, `portable-pty`, and crypto crates all pull native code, so only `windows-build.yml` on a Windows runner catches a break. Two recurring traps:

- **A `#[cfg(unix)]` API used unconditionally fails to compile on Windows (E0599).** `AgentClient::connect_env` (unix socket) needed a Windows arm (`connect_named_pipe` / `connect_pageant`) and the shared loop extracted into a generic helper (#52, #54). When an API has no Windows form, cfg-gate it and provide a Windows path or a clean error — do not leave the call unconditional.
- **A cfg-split command warns on Windows even when it compiles.** `set_native_menu` (`src-tauri/src/modules/menu.rs`) keeps its `NativeMenuModel` structs and its `app` param only for the `#[cfg(target_os = "macos")]` arm; on Windows they are dead code / an unused variable, so `windows-check.yml`'s `cargo check -D warnings` fails the PR (#190 shipped the warning, #191 added the gate). Guard the mac-only bits: `#[cfg_attr(not(target_os = "macos"), allow(dead_code))]` on the types, `#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]` on the fn. Prefer these cfg-scoped `allow`s over an `_`-prefix, which would also hide the value from the macOS arm that needs it.
- **A new native crate may need a Windows toolchain.** `aws-lc-sys` needs NASM; switching russh to its `ring` backend removed that so `cargo build` works on a stock Windows MSVC setup (#75). Before adding a crate with a `-sys` dependency, check its Windows build requirements.

`windows-check.yml` now compiles the Windows target on every PR with warnings-as-errors, so a broken cfg-gate or a Windows-only warning fails the PR automatically — no manual step. For anything `cargo check` cannot prove (bundling, native-crate link, runtime), still kick `windows-build.yml` (`workflow_dispatch`) and confirm it is green before merging.

## 7. No Windows backend: skip, do not crash or spin

Some capabilities have no Windows implementation and must degrade cleanly, not error or busy-loop:

- **pty foreground process**: `portable-pty` exposes none on Windows, so detecting that `claude`/`codex` is running (for image auto-attach) is mac/Linux only (#75).
- **process cwd**: no `/proc`, no `lsof`, so `read_process_cwd` returns `None`. The frontend must not keep polling `pty_cwd` every 1.2s per terminal into a dead backend — guard the poll off on Windows (#105), or drive cwd from OSC 7 shell integration instead (#115).

Rule: when a feature's backend is a no-op on Windows, gate the frontend caller too, so it does not fire pointless IPC or show a broken control.

## 8. Frontend: gate on `IS_WINDOWS`, not just `IS_MAC`

Platform branches written as "mac vs everything else" silently break Windows. Terminal paste was suppressed on all platforms and the smart-paste shortcut was `IS_MAC`-only, so Windows had no paste at all (#75). Window decorations are native on Windows and need a custom `TitleBar` (#67). Use `IS_WINDOWS` from `src/lib/platform.ts` and give Windows its own explicit branch.

---

## Release checklist (Windows)

The release is two-phase: `scripts/release.sh` runs on the mac (build, notarize, `latest.json`, `gh release create` with the `v*` tag), and the tag push triggers `windows-build.yml`, which builds on Windows, uploads `.exe`/`.msi`, and merges the `windows-x86_64` platform into `latest.json`.

- [ ] **Windows CI is green.** `windows-check.yml` gates *compilation* per PR, but `windows-build.yml` is the only thing that *bundles and links* the actual Windows binary; a red build means the release ships no working Windows binary.
- [ ] **The tagged commit still has a populated `CHANGELOG-NEXT.md`.** `windows-build.yml` re-patches `latest.json`'s `notes` from the changelog at the tagged commit. If the changelog was already archived/emptied, notes (macOS included) get wiped (#43). Do not point the tag at a master HEAD whose changelog was cleared.
- [ ] **Do not hand-patch `latest.json` before CI finishes** — `tauri-action` rewrites it mid-run and would clobber your patch. Patch only after CI, via `node scripts/patchManifestNotes.mjs <manifest> <changelog>` then `gh release upload --clobber`.
- [ ] **Functional-test on a real Windows host.** CI proves it compiles and bundles, not that it works. The recurring gap in this repo's PRs is the unchecked "Windows real verification" box. Use the CI artifact from the branch to smoke-test paste, launcher, terminal cwd, and the updater dialog.

## How to actually verify on Windows

- **Dev never shows console-flash / spawn-cost bugs** — a debug build owns a console. Reproduce these only in a **release** build (or the CI artifact).
- No Windows box? The per-PR `windows-check.yml` already gates *compilation* (warnings included); to test *behavior*, push the branch and run `windows-build.yml` via `workflow_dispatch`, then download the artifact.
- Keep platform logic in **pure functions parameterized by `windows: bool`** (see `pr/mod.rs`) so the Windows path has real unit tests that run on the mac, instead of `#[cfg(windows)]` code that is never executed until a user hits it.
