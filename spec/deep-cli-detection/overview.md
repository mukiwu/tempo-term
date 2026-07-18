# Deep CLI Detection for the First-Run Setup Wizard

Fixes GitHub issue #232 (Codex CLI installed under a custom npm prefix reported as "not installed") — the general case, beyond the probe-PATH fix that already landed in #236.

## Design: ask the user's shell, fall back to directory scanning

The wizard's real question is "does this command work in the user's terminal?" — so the primary detection path now asks the user's login shell directly instead of enumerating install locations:

```
$SHELL -ilc '<probe script running every tool's --version, sentinel-delimited>'
```

The shell loads the user's rc files, so its PATH covers every install method automatically (nvm, fnm, volta, asdf, Homebrew, custom npm prefix, bun, pnpm, deno, standalone installers, anything future). One shell spawn probes all tools.

The pre-existing directory-scan machinery (search_dirs + version-manager dirs + enriched child PATH, hardened by #236 and #237) is demoted to the **fallback path**:

- **Windows always** — there is no login shell; the GUI inherits the registry PATH and the dir scan covers npm/scoop/choco/fnm layouts.
- **Unix when the shell probe fails** — `$SHELL` unset, broken rc files, timeout, or a tool missing from the shell's output (each tool falls back individually).

A final verdict layer keeps the semantics honest: an executable found on disk whose `--version` still cannot be read counts as **installed** (version unknown), never "not installed" — the wizard's job is deciding whether to run the installer, and a present binary must not be reinstalled.

## Why this shape

- Root cause of #232 was never "can't find the file" (the shim was in `~/.local/bin`, already scanned); it was the probe running with the GUI's minimal PATH so the `#!/usr/bin/env node` shebang failed. #236 fixed that probe; the shell-first design goes further and makes the whole question match the user's terminal reality.
- The previously planned static-dir enumeration (npmrc prefix, bun, pnpm, deno, ~/bin) is dropped: the shell already knows all of it. If field reports ever show a popular setup the shell path misses on a broken-rc machine, individual dirs can still be added to `search_dirs` — the seam stays.
- Install commands (`install_tool`) keep #236's enriched `command_path` PATH; that is orthogonal to detection and already shipped.

## Constraints

- No new Tauri commands, no capability or permission changes; `detect_tools` / `install_tool` signatures unchanged.
- Pure, parameter-injected helpers (script builder, output parser, shell selection, verdict) with fs/env/spawn isolated in thin wrappers — every branch unit-testable on the macOS CI runner.
- Any new spawn goes through `tool_command` (CREATE_NO_WINDOW per the windows-tauri skill), bounded by a timeout and killed on overrun, degrading to the fallback silently.

Full task breakdown: [detection.md](./detection.md)

## Status

- #236 (merged): fallback probe/install PATH enrichment + codex standalone installer.
- #237: hardening follow-up (empty PATH entry filter, `| bash`).
- This spec: the shell-first probe + verdict layer, to be implemented next.
